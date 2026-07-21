// Orchestrator: single entry point called by whatsapp-webhook and agent-run.
// Path selection:
//   - CONFIRMAR / CANCELAR are always intercepted deterministically to
//     guarantee atomicity, ownership check, and idempotence.
//   - Otherwise, if LOVABLE_API_KEY is available, run the LLM tool-calling
//     loop; on any failure (network, timeout, rate limit) fall back to the
//     deterministic interpreter labeled as "deterministic_fallback".
//
// Every run is recorded in agent_runs; every tool call in agent_tool_calls.
//
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { interpret, type ParsedIntent, todaySaoPaulo } from "./parser.ts";
import { isLLMConfigured, runAgentTurn, sanitizeError } from "./llm.ts";
import { loadActivePrompt } from "./prompt.ts";
import {
  create_transaction_draft, create_transfer_draft,
  create_goal_draft, add_goal_contribution_draft, create_debt_draft,
  run_before_spending, get_financial_summary, list_recent_transactions,
  type ToolContext,
} from "./tools.ts";
import {
  service as _service,
  findPending as _findPending,
  enqueueReply as _enqueueReply,
  buildReceipt as _buildReceipt,
  mapConversationRow as _mapConversationRow,
} from "./core/index.ts";

export type OrchestratorInput = {
  user_id: string;
  conversation_id: string;
  inbound_message_id: string;
  text: string;
  source: "whatsapp" | "simulator";
  to_phone: string;
};

export type OrchestratorResult = {
  reply: string;
  reply_kind: "receipt" | "draft" | "question" | "info" | "unlinked" | "cancelled" | "expired";
  path: "llm" | "deterministic_fallback";
  draft_id?: string;
  run_id?: string;
  result?: unknown;
};

const NUM_BR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Re-exports (mantêm compatibilidade com testes e call-sites existentes).
export const service = _service;
export const findPending = _findPending;
export const enqueueReply = _enqueueReply;
export const mapConversationRow = _mapConversationRow;
const buildReceipt = _buildReceipt;

export const FRIENDLY_ORCHESTRATOR_ERROR =
  "Tive um problema para responder agora. Pode tentar novamente em instantes? 💛";

// ---------- Deterministic fallback (uses tools for uniformity) ----------

async function fallbackTurn(sb: SupabaseClient, input: OrchestratorInput): Promise<{ reply: string; draft_id?: string; kind: OrchestratorResult["reply_kind"] }> {
  const intent: ParsedIntent = interpret(input.text);
  const ctx: ToolContext = { sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: input.text };

  if (intent.kind === "query") {
    if (intent.topic === "summary") {
      const r = await get_financial_summary(ctx);
      if (r.ok) {
        const s = r.result as { income: number; expense: number; net: number };
        return { reply: `Neste mês: entradas ${NUM_BR.format(s.income)}, saídas ${NUM_BR.format(s.expense)}, saldo do período ${NUM_BR.format(s.net)}.`, kind: "info" };
      }
    }
    if (intent.topic === "recent") {
      const r = await list_recent_transactions(ctx, { limit: 5 });
      const rows = (r.ok ? r.result : []) as any[];
      if (rows.length === 0) return { reply: "Ainda não há lançamentos por aqui.", kind: "info" };
      const lines = rows.map(x => `• ${x.occurred_at} · ${x.type === "expense" ? "-" : "+"}${NUM_BR.format(Number(x.amount))}${x.description ? ` · ${x.description}` : ""}`);
      return { reply: "Seus últimos lançamentos:\n" + lines.join("\n"), kind: "info" };
    }
    if (intent.topic === "before_spending" && intent.amount) {
      const r = await run_before_spending(ctx, { amount: intent.amount });
      if (r.ok) {
        const o = r.result as any;
        const parts = [
          `Se você gastar ${NUM_BR.format(intent.amount)} hoje, o saldo estimado fica em ${NUM_BR.format(o.availableAfter)}.`,
          `Base do cálculo: saldo total ${NUM_BR.format(o.totalCash)}, compromissos previstos ${NUM_BR.format(o.upcomingExpense)}, entradas previstas ${NUM_BR.format(o.upcomingIncome)} em ~30 dias.`,
        ];
        if (o.assumptions?.length) parts.push("Premissas: " + o.assumptions.join(" "));
        if (o.missingData?.length) parts.push("Dados faltantes: " + o.missingData.join(" "));
        return { reply: parts.join("\n"), kind: "info" };
      }
    }
  }

  if (intent.kind === "transaction") {
    const r = await create_transaction_draft(ctx, {
      type: intent.type, amount: intent.amount,
      account: intent.account_hint ?? "",
      category: intent.category_hint,
      occurred_at: intent.occurred_at,
      description: intent.description,
    });
    if (!r.ok) {
      if (r.error === "account_not_found") {
        return { reply: "Em qual conta eu registro? (ex.: Nubank, Itaú, Carteira)", kind: "question" };
      }
      return { reply: "Não consegui entender direito. Pode repetir?", kind: "info" };
    }
    return { reply: `${(r.result as any).summary}\nResponda *CONFIRMAR* para registrar ou *CANCELAR* para descartar.`, draft_id: (r.result as any).draft_id, kind: "draft" };
  }

  if (intent.kind === "transfer") {
    const r = await create_transfer_draft(ctx, {
      amount: intent.amount, from_account: intent.from_hint ?? "", to_account: intent.to_hint ?? "",
      occurred_at: intent.occurred_at,
    });
    if (!r.ok) return { reply: "Escreva assim: “transferir 100 de Nubank para Itaú”.", kind: "question" };
    return { reply: `${(r.result as any).summary}\nResponda *CONFIRMAR* ou *CANCELAR*.`, draft_id: (r.result as any).draft_id, kind: "draft" };
  }

  if (intent.kind === "goal_contribution" && intent.goal_hint) {
    const r = await add_goal_contribution_draft(ctx, { goal: intent.goal_hint, amount: intent.amount, occurred_at: intent.occurred_at });
    if (r.ok) return { reply: `${(r.result as any).summary}\nResponda *CONFIRMAR* ou *CANCELAR*.`, draft_id: (r.result as any).draft_id, kind: "draft" };
  }

  return { reply: "Ainda estou aprendendo. Você pode me contar assim: “gastei 42,90 no almoço hoje no Nubank”, “recebi 3000 salário”, “transferir 100 de Nubank para Itaú”.", kind: "info" };
}

// ---------- Main entry ----------

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const sb = service();

  // Dedupe by inbound_message_id
  const { data: existing } = await sb.from("outbound_messages")
    .select("body").eq("inbound_message_id", input.inbound_message_id).maybeSingle();
  if (existing) return { reply: existing.body as string, reply_kind: "info", path: "deterministic_fallback" };

  const idem = `run:${input.inbound_message_id}`;

  // Deterministic pre-intercept for CONFIRMAR / CANCELAR — always
  const intent = interpret(input.text);
  const pending = await findPending(sb, input.conversation_id, input.user_id);

  if (intent.kind === "confirm") {
    if (!pending) {
      const body = "Não encontrei nada pendente para confirmar. Me conte a operação primeiro (ex.: “gastei 42,90 no almoço hoje”).";
      await enqueueReply(sb, { ...input, body, idempotency_key: idem });
      return { reply: body, reply_kind: "info", path: "deterministic_fallback" };
    }
    const { data: exec } = await sb.rpc("agent_execute_confirmation", {
      p_confirmation_id: pending.id, p_source_message_id: input.inbound_message_id,
    });
    const okExec = exec as { ok: boolean; result?: any; error?: string; idempotent?: boolean } | null;
    let body: string;
    if (okExec?.ok) {
      body = okExec.idempotent
        ? "Essa operação já havia sido confirmada. Está tudo certo por aqui. ✅"
        : buildReceipt(pending.kind as string, okExec.result);
    } else {
      body = okExec?.error === "expired"
        ? "Este pedido expirou. Envie de novo, por favor."
        : "Não consegui concluir a operação. Vamos tentar de novo?";
    }
    await enqueueReply(sb, { ...input, body, idempotency_key: idem });
    return { reply: body, reply_kind: "receipt", draft_id: pending.id, result: okExec?.result, path: "deterministic_fallback" };
  }

  if (intent.kind === "cancel") {
    if (pending) await sb.from("pending_confirmations").update({ status: "cancelled" }).eq("id", pending.id);
    const body = "Combinado, cancelei este pedido. Se mudar de ideia, é só me contar de novo. 🙂";
    await enqueueReply(sb, { ...input, body, idempotency_key: idem });
    return { reply: body, reply_kind: "cancelled", path: "deterministic_fallback" };
  }

  // ----- Guarded run: any failure below still produces a friendly reply -----
  const startedAt = Date.now();
  let prompt: Awaited<ReturnType<typeof loadActivePrompt>> | null = null;
  try { prompt = await loadActivePrompt(sb); }
  catch (e) { console.error("[orchestrator] loadActivePrompt failed", String((e as Error).message).slice(0, 200)); }

  let run_id: string | undefined;
  try {
    const { data: run } = await sb.from("agent_runs").insert({
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      prompt_version_id: prompt?.id ?? null,
      model: prompt?.model ?? "unknown",
      status: "running",
      started_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    run_id = run?.id as string | undefined;
  } catch (e) {
    console.error("[orchestrator] agent_runs insert failed", String((e as Error).message).slice(0, 200));
  }

  let path: "llm" | "deterministic_fallback" = "deterministic_fallback";
  let reply = ""; let draft_id: string | undefined;
  let kind: OrchestratorResult["reply_kind"] = "info";
  let tokensIn = 0, tokensOut = 0, steps = 0;
  let errorSanitized: string | null = null;
  const toolCallLog: Array<{ step_index: number; tool_name: string; args: any; result: any; ok: boolean; duration_ms: number; error?: string | null }> = [];

  if (prompt && isLLMConfigured()) {
    try {
      // Load recent conversation history (real schema: direction/body_masked).
      const { data: histRows } = await sb.from("conversation_messages")
        .select("direction, body_masked, created_at")
        .eq("conversation_id", input.conversation_id)
        .order("created_at", { ascending: false })
        .limit(12);
      const history = ((histRows ?? []) as Array<{ direction: string; body_masked: string }>)
        .reverse()
        .map(mapConversationRow)
        .filter((r): r is { role: "user" | "assistant"; content: string } => r !== null);

      const turn = await runAgentTurn(
        { sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: input.text },
        input.text,
        { model: prompt.model, maxSteps: prompt.max_steps, temperature: prompt.temperature, systemPrompt: prompt.system_prompt, timeoutMs: 25_000, history },
      );
      reply = turn.reply;
      path = "llm";
      tokensIn = turn.tokensIn; tokensOut = turn.tokensOut; steps = turn.steps;
      toolCallLog.push(...turn.toolCalls);
      const draftCall = turn.toolCalls.find(c => c.ok && c.tool_name.endsWith("_draft"));
      if (draftCall) { draft_id = draftCall.result?.draft_id; kind = "draft"; }
      else if (turn.toolCalls.some(c => c.tool_name === "cancel_pending_action" && c.ok)) kind = "cancelled";
      else kind = "info";
    } catch (e) {
      errorSanitized = sanitizeError(e);
      path = "deterministic_fallback";
    }
  }

  if (path === "deterministic_fallback") {
    try {
      const fb = await fallbackTurn(sb, input);
      reply = fb.reply; draft_id = fb.draft_id; kind = fb.kind;
    } catch (e) {
      errorSanitized = errorSanitized ?? sanitizeError(e);
      reply = FRIENDLY_ORCHESTRATOR_ERROR;
      kind = "info";
    }
  }

  const latency = Date.now() - startedAt;

  if (run_id) {
    try {
      await sb.from("agent_runs").update({
        status: errorSanitized ? "error" : "done",
        ended_at: new Date().toISOString(),
        path, steps,
        tokens_in: tokensIn || null,
        tokens_out: tokensOut || null,
        latency_ms: latency,
        error_sanitized: errorSanitized,
        error_masked: errorSanitized,
      }).eq("id", run_id);
      if (toolCallLog.length > 0) {
        await sb.from("agent_tool_calls").insert(
          toolCallLog.map(c => ({
            run_id, step_index: c.step_index, tool_name: c.tool_name,
            args: c.args ?? {}, result: c.result ?? null,
            ok: c.ok, duration_ms: c.duration_ms, error: c.error ?? null,
          })),
        );
      }
    } catch (e) {
      console.error("[orchestrator] run persistence failed", String((e as Error).message).slice(0, 200));
    }
  }

  if (!reply) reply = FRIENDLY_ORCHESTRATOR_ERROR;
  await enqueueReply(sb, { ...input, body: reply, idempotency_key: idem });
  return { reply, reply_kind: kind, path, draft_id, run_id };
}
