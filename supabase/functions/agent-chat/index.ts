// In-app assessor chat. Delegates to the same tool-calling agent core used by
// WhatsApp (agent-run/orchestrator): loads recent conversation history, calls
// runAgentTurn with the same tools + active prompt, intercepts CONFIRMAR /
// CANCELAR deterministically against pending_confirmations, and returns any
// pending draft so the app can render a confirmation card.
//
// Source is always 'app'; JWT of the user is verified; nothing is written to
// WhatsApp outbound_messages.
// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { runAgentTurn, isLLMConfigured, sanitizeError } from "../_shared/agent/llm.ts";
import { loadActivePrompt } from "../_shared/agent/prompt.ts";
import { interpret, parseBrAmount } from "../_shared/agent/parser.ts";
import { create_transaction_draft, resolveCreditCardFull } from "../_shared/agent/tools.ts";
import { extractSpans } from "../_shared/agent/extract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_MSG_LEN = 2000;
const HISTORY_TURNS = 20;

type Pending = {
  id: string;
  kind: string;
  summary_text: string;
  payload: any;
  expires_at: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
  const user_id = userRes.user.id;

  const body = await req.json().catch(() => ({}));
  const rawText = String(body?.text ?? "").trim();
  const action = String(body?.action ?? "").trim(); // "confirm" | "cancel" | ""
  const pendingId = typeof body?.pending_id === "string" ? body.pending_id : null;
  const requested_conv = typeof body?.conversation_id === "string" ? body.conversation_id : null;
  const text = rawText.slice(0, MAX_MSG_LEN);
  if (!text && !action) return json({ error: "missing_text" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // Simple rate limit: 40 msgs/min per user for app source
  const { count } = await svc
    .from("conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user_id)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) > 40) return json({ error: "rate_limited" }, 429);

  // Get or create app conversation
  let conversation_id = requested_conv;
  if (conversation_id) {
    const { data: conv } = await svc.from("conversations")
      .select("id, user_id, source")
      .eq("id", conversation_id).maybeSingle();
    if (!conv || conv.user_id !== user_id || conv.source !== "app") conversation_id = null;
  }
  if (!conversation_id) {
    const { data: newConv, error: convErr } = await svc.from("conversations")
      .insert({ user_id, source: "app", phone_e164: null, last_message_at: new Date().toISOString() } as any)
      .select("id").single();
    if (convErr) return json({ error: "conv_create_failed" }, 500);
    conversation_id = newConv!.id as string;
  }

  // ---- Deterministic short-circuit: explicit confirm/cancel actions from UI ----
  if (action === "confirm" || action === "cancel") {
    // Persist the click as an inbound message for auditability
    await svc.from("conversation_messages").insert({
      conversation_id, user_id, direction: "inbound",
      body_masked: action === "confirm" ? "[Confirmar]" : "[Cancelar]",
    } as any);

    const pending = await findPending(svc, conversation_id, user_id, pendingId);
    let reply = "";
    let executed: any = null;
    let pendingOut: Pending | null = null;

    if (!pending) {
      reply = "Não encontrei nada pendente. Me conte o que você quer registrar.";
    } else if (action === "cancel") {
      await svc.from("pending_confirmations").update({ status: "cancelled" } as any).eq("id", pending.id);
      reply = "Combinado, cancelei este pedido.";
    } else {
      const { data: exec, error: execErr } = await svc.rpc("agent_execute_confirmation", {
        p_confirmation_id: pending.id, p_source_message_id: null,
      });
      const okExec = exec as { ok: boolean; result?: any; error?: string; idempotent?: boolean } | null;
      if (execErr || !okExec?.ok) {
        reply = okExec?.error === "expired"
          ? "Este pedido expirou. Envie de novo, por favor."
          : okExec?.error === "card_not_owned"
          ? "Não consegui encontrar esse cartão. Confira e tente de novo."
          : "Não consegui concluir a operação. NÃO foi registrada. Quer tentar novamente?";
      } else {
        executed = okExec.result;
        reply = okExec.idempotent
          ? "Essa operação já havia sido confirmada. ✅"
          : buildReceipt(pending.kind, okExec.result);
      }
    }

    await svc.from("conversation_messages").insert({
      conversation_id, user_id, direction: "outbound", body_masked: reply,
    } as any);
    await svc.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", conversation_id);
    return json({ ok: true, conversation_id, reply, pending: pendingOut, executed });
  }

  // ---- Free-form text turn ----
  await svc.from("conversation_messages").insert({
    conversation_id, user_id, direction: "inbound", body_masked: text,
  } as any);

  // Deterministic intercept for CONFIRMAR / CANCELAR typed as free text
  const parsed = interpret(text);
  if (parsed.kind === "confirm" || parsed.kind === "cancel") {
    const pending = await findPending(svc, conversation_id, user_id, null);
    let reply = "";
    let executed: any = null;
    if (!pending) {
      reply = parsed.kind === "confirm"
        ? "Não encontrei nada pendente para confirmar. Me conte a operação primeiro."
        : "Nada pendente para cancelar por aqui.";
    } else if (parsed.kind === "cancel") {
      await svc.from("pending_confirmations").update({ status: "cancelled" } as any).eq("id", pending.id);
      reply = "Combinado, cancelei este pedido.";
    } else {
      const { data: exec } = await svc.rpc("agent_execute_confirmation", {
        p_confirmation_id: pending.id, p_source_message_id: null,
      });
      const okExec = exec as { ok: boolean; result?: any; error?: string; idempotent?: boolean } | null;
      if (!okExec?.ok) {
        reply = okExec?.error === "expired"
          ? "Este pedido expirou. Envie de novo, por favor."
          : "Não consegui concluir. NÃO foi registrada.";
      } else {
        executed = okExec.result;
        reply = okExec.idempotent
          ? "Já havia sido confirmada. ✅"
          : buildReceipt(pending.kind, okExec.result);
      }
    }
    await svc.from("conversation_messages").insert({
      conversation_id, user_id, direction: "outbound", body_masked: reply,
    } as any);
    await svc.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", conversation_id);
    return json({ ok: true, conversation_id, reply, pending: null, executed });
  }

  // Load recent history (exclude the just-inserted inbound message)
  const { data: histRows } = await svc.from("conversation_messages")
    .select("direction, body_masked, created_at")
    .eq("conversation_id", conversation_id).eq("user_id", user_id)
    .order("created_at", { ascending: false }).limit(HISTORY_TURNS + 1);
  const history = (histRows ?? [])
    .slice(1) // drop the current inbound
    .reverse()
    .map((r: any) => ({
      role: r.direction === "inbound" ? "user" as const : "assistant" as const,
      content: String(r.body_masked ?? ""),
    }));

  // Run the LLM turn with tools
  let reply = "";
  let errorSanitized: string | null = null;
  const prompt = await loadActivePrompt(svc);
  const startedAt = Date.now();
  const { data: run } = await svc.from("agent_runs").insert({
    user_id, conversation_id, prompt_version_id: prompt.id,
    model: prompt.model, status: "running", started_at: new Date().toISOString(),
  } as any).select("id").maybeSingle();
  const run_id = run?.id as string | undefined;
  const toolCallLog: any[] = [];
  let steps = 0, tokensIn = 0, tokensOut = 0;
  let fastPathUsed = false;

  // ---------- Deterministic fast-path for card expenses ----------
  // Guarantees a tool call even if the model refuses. Handles two shapes:
  //  (a) Single message with amount + "cartão"/bank keyword.
  //  (b) Follow-up like "É o único cartão cadastrado" / "Cartão Itaú" completing
  //      an unresolved expense from the previous user turn.
  try {
    const fast = await tryFastPathCardExpense(svc, { user_id, conversation_id }, text, history);
    if (fast) {
      steps = 1;
      toolCallLog.push({
        step_index: 1, tool_name: "create_transaction_draft",
        args: fast.args, result: fast.result.ok ? fast.result.result : null,
        ok: fast.result.ok, duration_ms: fast.duration_ms,
        error: fast.result.ok ? null : (fast.result as any).error,
      });
      reply = fast.reply;
      fastPathUsed = true;
    }
  } catch (_e) { /* fall through to LLM */ }

  if (!fastPathUsed && isLLMConfigured()) {
    try {
      const turn = await runAgentTurn(
        { sb: svc, user_id, conversation_id },
        text,
        { model: prompt.model, maxSteps: prompt.max_steps, temperature: prompt.temperature, systemPrompt: prompt.system_prompt, timeoutMs: 25_000, history },
      );
      reply = turn.reply;
      steps = turn.steps; tokensIn = turn.tokensIn; tokensOut = turn.tokensOut;
      toolCallLog.push(...turn.toolCalls);
    } catch (e) {
      errorSanitized = sanitizeError(e);
    }
  } else if (!fastPathUsed) {
    reply = "Assessor indisponível no momento. Tente novamente em instantes.";
  }
  if (!reply) reply = "Certo. Pode me dizer em uma frase o que você quer fazer?";

  // Anti-loop guard: if the assistant is about to repeat the same question it
  // already asked in the last 3 turns without new data, replace with a useful
  // fallback that lists real options.
  const lastAssistant = [...history].reverse().find(h => h.role === "assistant")?.content ?? "";
  if (
    !fastPathUsed && reply.trim().endsWith("?") &&
    normalizeQ(reply) === normalizeQ(lastAssistant) && normalizeQ(reply).length > 5
  ) {
    reply = await antiLoopFallback(svc, user_id, text) ?? reply;
    toolCallLog.push({ step_index: (steps || 0) + 1, tool_name: "loop_guard_triggered", args: {}, result: {}, ok: true, duration_ms: 0, error: null });
  }


  // Look for the pending draft created during this turn (single per conversation)
  const pendingOut = await findPending(svc, conversation_id, user_id, null);

  const latency = Date.now() - startedAt;
  if (run_id) {
    await svc.from("agent_runs").update({
      status: errorSanitized ? "error" : "done",
      ended_at: new Date().toISOString(),
      path: "llm", steps,
      tokens_in: tokensIn || null, tokens_out: tokensOut || null,
      latency_ms: latency,
      error_sanitized: errorSanitized, error_masked: errorSanitized,
    } as any).eq("id", run_id);
    if (toolCallLog.length > 0) {
      await svc.from("agent_tool_calls").insert(
        toolCallLog.map((c) => ({
          run_id, step_index: c.step_index, tool_name: c.tool_name,
          args: c.args ?? {}, result: c.result ?? null,
          ok: c.ok, duration_ms: c.duration_ms, error: c.error ?? null,
        })),
      );
    }
  }

  await svc.from("conversation_messages").insert({
    conversation_id, user_id, direction: "outbound", body_masked: reply,
  } as any);
  await svc.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", conversation_id);

  return json({ ok: true, conversation_id, reply, pending: pendingOut, executed: null });
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function buildReceipt(kind: string, result: any): string {
  if (kind === "transaction") {
    const t = result?.type === "income" ? "Receita" : "Gasto";
    const amt = BRL.format(Number(result?.amount ?? 0));
    const via = result?.payment_method === "credit_card" ? " no cartão" : "";
    return `${t} registrado${via}: ${amt}. ✅`;
  }
  if (kind === "transfer") return `Transferência registrada: ${BRL.format(Number(result?.amount ?? 0))}. ✅`;
  if (kind === "goal") return `Meta criada: ${result?.name}. ✅`;
  if (kind === "goal_contribution") return `Aporte registrado: ${BRL.format(Number(result?.amount ?? 0))}. ✅`;
  if (kind === "debt") return `Dívida registrada: ${result?.name}. ✅`;
  return "Pronto, registrei. ✅";
}

async function findPending(sb: SupabaseClient, conversation_id: string, user_id: string, pendingId: string | null): Promise<Pending | null> {
  const q = sb.from("pending_confirmations")
    .select("id, kind, payload, summary_text, status, expires_at")
    .eq("conversation_id", conversation_id).eq("user_id", user_id).eq("status", "pending");
  const { data } = pendingId ? await q.eq("id", pendingId).maybeSingle() : await q.maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string, kind: data.kind as string,
    summary_text: data.summary_text as string, payload: data.payload,
    expires_at: data.expires_at as string,
  };
}

// ---------------- Fast-path helpers ----------------

const CARD_KEYWORDS = /\b(cart[aã]o|itau|ita[uú]|nubank|bradesco|santander|inter|c6|xp|will|mercadopago|picpay|caixa)\b/i;
const EXPENSE_KEYWORDS = /\b(gast(ei|o|ando)|paguei|comprei|registr(e|a|ar|ei)|inclu(a|ir|i)|lan[cç]ament|d[eé]bito|cobr(ei|ou|ar|ança))\b/i;
const SINGLE_CARD_HINT = /\b(único|unico|so\s+tenho|so\s+um|apenas\s+um|o\s+único|é\s+o\s+único)\b/i;

function normalizeQ(s: string): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9? ]+/g, " ").replace(/\s+/g, " ").trim();
}

async function tryFastPathCardExpense(
  sb: SupabaseClient,
  ctx: { user_id: string; conversation_id: string },
  currentText: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<null | { args: any; result: any; duration_ms: number; reply: string }> {
  const t0 = Date.now();
  const now = currentText;
  const nowAmountMatch = now.match(/(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  const nowAmount = nowAmountMatch ? parseBrAmount(nowAmountMatch[1]) : null;
  const nowHasCard = CARD_KEYWORDS.test(now);
  const nowHasExpense = EXPENSE_KEYWORDS.test(now) || /\bde\s+\d/.test(now);

  let amount: number | null = null;
  let cardHint: string | null = null;
  let description: string | undefined;

  // Case A: single message w/ amount + expense + card keyword.
  if (nowAmount && (nowHasExpense || nowHasCard) && nowHasCard) {
    amount = nowAmount;
    cardHint = extractCardHint(now);
    description = extractDescription(now);
  } else if (nowHasCard || SINGLE_CARD_HINT.test(now)) {
    // Case B: follow-up completing a previous unresolved expense.
    const lastUser = [...history].reverse().find(h => h.role === "user")?.content ?? "";
    const lastAmountMatch = lastUser.match(/(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
    const lastAmount = lastAmountMatch ? parseBrAmount(lastAmountMatch[1]) : null;
    if (lastAmount && (EXPENSE_KEYWORDS.test(lastUser) || /\bde\s+\d/.test(lastUser))) {
      amount = lastAmount;
      cardHint = SINGLE_CARD_HINT.test(now) ? "" : extractCardHint(now);
      description = extractDescription(lastUser);
    }
  }

  if (amount === null) return null;

  // Resolve card up-front to produce structured error messaging.
  const resolved = await resolveCreditCardFull({ sb, user_id: ctx.user_id, conversation_id: ctx.conversation_id }, cardHint ?? undefined);
  if (resolved.kind === "none" && resolved.available.length === 0) {
    return {
      args: { type: "expense", amount, credit_card: cardHint, description },
      result: { ok: false, error: "card_not_found", available: [] },
      duration_ms: Date.now() - t0,
      reply: "Você ainda não tem cartão cadastrado. Cadastre um em /app/cartoes e eu registro o gasto em seguida.",
    };
  }
  if (resolved.kind === "multiple") {
    const names = resolved.choices.map(c => `• ${c.name}`).join("\n");
    return {
      args: { type: "expense", amount, credit_card: cardHint, description },
      result: { ok: false, error: "card_ambiguous", choices: resolved.choices },
      duration_ms: Date.now() - t0,
      reply: `Você tem mais de um cartão. Qual deles?\n${names}`,
    };
  }

  const args = { type: "expense" as const, amount, credit_card: cardHint || resolved.name, description };
  const result = await create_transaction_draft({ sb, user_id: ctx.user_id, conversation_id: ctx.conversation_id }, args);
  if (!result.ok) {
    return {
      args, result, duration_ms: Date.now() - t0,
      reply: "Não consegui preparar esse lançamento. Pode confirmar valor e cartão?",
    };
  }
  const summary = (result as any).result.summary as string;
  return {
    args, result, duration_ms: Date.now() - t0,
    reply: `${summary}\nResponda *CONFIRMAR* para registrar ou *CANCELAR* para descartar.`,
  };
}

function extractCardHint(text: string): string | null {
  const m = text.match(/cart[aã]o(?:\s+de\s+cr[eé]dito)?\s+([A-Za-zÀ-ÿ0-9]{2,30})/i);
  if (m) return `cartão ${m[1]}`;
  const bank = text.match(CARD_KEYWORDS);
  return bank ? bank[0] : null;
}

function extractDescription(text: string): string | undefined {
  const m = text.match(/\bde\s+([A-Za-zÀ-ÿ0-9]{2,40})\b/i);
  return m ? m[1].trim() : undefined;
}

async function antiLoopFallback(sb: SupabaseClient, user_id: string, _text: string): Promise<string | null> {
  const { data } = await sb.from("credit_cards").select("name")
    .eq("user_id", user_id).eq("active", true).order("name");
  const names = (data ?? []).map((c: any) => c.name);
  if (names.length === 0) return "Você ainda não tem cartão cadastrado. Cadastre em /app/cartoes.";
  if (names.length === 1) return `Vou usar seu único cartão cadastrado: ${names[0]}. Me diga o valor e o que foi.`;
  return `Seus cartões: ${names.join(", ")}. Qual deles?`;
}

