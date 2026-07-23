// AppAdapter — routes in-app assessor turns through the shared AgentCore
// while preserving app-only deterministic fast-paths (analytics + card
// expense) and the confirm/cancel action buttons.
//
// The HTTP wrapper (agent-chat/index.ts) only handles auth, rate limit,
// conversation lookup and the JSON contract; every decision the agent
// makes lives here or deeper in the Core.
// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleTurn } from "../AgentCore.ts";
import { evaluate as evaluatePolicy } from "../PolicyEngine.ts";
import { routeIntent } from "../IntentRouter.ts";
import { buildReceipt } from "../ReceiptBuilder.ts";
import { loadHistory } from "../ConversationHistory.ts";
import { analyze_spending, create_transaction_draft, generate_chart_artifact, resolveCreditCardFull } from "../../tools.ts";
import { extractSpans } from "../../extract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const HISTORY_TURNS = 20;

const CARD_KEYWORDS = /\b(cart[aã]o|itau|ita[uú]|nubank|bradesco|santander|inter|c6|xp|will|mercadopago|picpay|caixa)\b/i;
const SINGLE_CARD_HINT = /\b(único|unico|so\s+tenho|so\s+um|apenas\s+um|o\s+único|é\s+o\s+único)\b/i;

export type AppTurnResult = {
  reply: string;
  pending: { id: string; kind: string; summary_text: string; payload: any; expires_at: string } | null;
  executed: any;
  report?: any;
  artifact?: any;
};

async function findRecentArtifact(sb: SupabaseClient, conversation_id: string, user_id: string, sinceIso: string) {
  const { data } = await sb.from("agent_artifacts")
    .select("id, kind, payload, created_at")
    .eq("user_id", user_id).eq("conversation_id", conversation_id)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { artifact_id: (data as any).id, payload: (data as any).payload } : null;
}

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findPendingApp(sb: SupabaseClient, conversation_id: string, user_id: string, pendingId: string | null) {
  const q = sb.from("pending_confirmations")
    .select("id, kind, payload, summary_text, status, expires_at")
    .eq("conversation_id", conversation_id).eq("user_id", user_id).eq("status", "pending");
  const { data } = pendingId ? await q.eq("id", pendingId).maybeSingle() : await q.maybeSingle();
  if (!data) return null;
  return {
    id: (data as any).id as string, kind: (data as any).kind as string,
    summary_text: (data as any).summary_text as string, payload: (data as any).payload,
    expires_at: (data as any).expires_at as string,
  };
}

// ---- Action buttons (explicit UI confirm/cancel) -----------------------------
export async function handleAppAction(args: {
  user_id: string; conversation_id: string; action: "confirm" | "cancel"; pending_id: string | null;
}): Promise<AppTurnResult> {
  const sb = svc();
  await sb.from("conversation_messages").insert({
    conversation_id: args.conversation_id, user_id: args.user_id, direction: "inbound",
    body_masked: args.action === "confirm" ? "[Confirmar]" : "[Cancelar]",
  } as any);

  const pending = await findPendingApp(sb, args.conversation_id, args.user_id, args.pending_id);
  let reply = "";
  let executed: any = null;

  if (!pending) {
    reply = "Não encontrei nada pendente. Me conte o que você quer registrar.";
  } else if (args.action === "cancel") {
    await sb.from("pending_confirmations").update({ status: "cancelled" } as any).eq("id", pending.id);
    reply = "Combinado, cancelei este pedido.";
  } else {
    const { data: exec, error: execErr } = await sb.rpc("agent_execute_confirmation", {
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

  await sb.from("conversation_messages").insert({
    conversation_id: args.conversation_id, user_id: args.user_id, direction: "outbound", body_masked: reply,
  } as any);
  await sb.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", args.conversation_id);
  return { reply, pending: null, executed };
}

// ---- Free-text turn ---------------------------------------------------------
export async function handleAppMessage(args: {
  user_id: string; conversation_id: string; text: string;
}): Promise<AppTurnResult> {
  const sb = svc();

  // Persist inbound message first so history is coherent (Core loader will
  // exclude it via excludeMessageId when it inserts through handleTurn).
  const { data: inbound } = await sb.from("conversation_messages").insert({
    conversation_id: args.conversation_id, user_id: args.user_id, direction: "inbound", body_masked: args.text,
  } as any).select("id").maybeSingle();
  const inbound_message_id = ((inbound as any)?.id as string | undefined) ?? crypto.randomUUID();
  const turnStartedAt = new Date().toISOString();

  // Free-text CONFIRMAR / CANCELAR (parity with WhatsApp: PolicyEngine)
  const routed = routeIntent(args.text);
  if (routed.intent.kind === "confirm" || routed.intent.kind === "cancel") {
    const decision = await evaluatePolicy(sb, {
      user_id: args.user_id, conversation_id: args.conversation_id,
      inbound_message_id: null, intent: routed.intent,
    });
    const reply = decision.kind === "reply" ? decision.body : "Não entendi.";
    await sb.from("conversation_messages").insert({
      conversation_id: args.conversation_id, user_id: args.user_id, direction: "outbound", body_masked: reply,
    } as any);
    await sb.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", args.conversation_id);
    return { reply, pending: null, executed: decision.kind === "reply" ? decision.result ?? null : null };
  }

  const history = await loadHistory(sb, args.conversation_id, { limit: HISTORY_TURNS, excludeMessageId: inbound_message_id });

  // Fast-path 1: analytics (só quando o usuário NÃO pediu gráfico específico
  // — nesses casos deixamos o LLM chamar generate_chart_artifact).
  if (isAnalyticsRequest(args.text) && !wantsChart(args.text)) {
    const argsA = analyticsArgs(args.text);
    const result = await analyze_spending({ sb, user_id: args.user_id, conversation_id: args.conversation_id }, argsA);
    if (result.ok) {
      const reply = buildAnalyticsReply((result as any).result);
      await sb.from("conversation_messages").insert({
        conversation_id: args.conversation_id, user_id: args.user_id, direction: "outbound", body_masked: reply,
      } as any);
      await sb.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", args.conversation_id);
      const pendingOut = await findPendingApp(sb, args.conversation_id, args.user_id, null);
      return { reply, pending: pendingOut, executed: null, report: (result as any).result };
    }
  }

  // Fast-path 2: card expense
  const fast = await tryFastPathCardExpense(sb, args, history);
  if (fast) {
    await sb.from("conversation_messages").insert({
      conversation_id: args.conversation_id, user_id: args.user_id, direction: "outbound", body_masked: fast.reply,
    } as any);
    await sb.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", args.conversation_id);
    const pendingOut = await findPendingApp(sb, args.conversation_id, args.user_id, null);
    return { reply: fast.reply, pending: pendingOut, executed: null };
  }

  // Default: shared Core (LLM + tools, deterministic fallback, telemetry)
  const turn = await handleTurn({
    user_id: args.user_id,
    conversation_id: args.conversation_id,
    inbound_message_id,
    text: args.text,
    channel: "app",
  });

  const pendingOut = await findPendingApp(sb, args.conversation_id, args.user_id, null);

  // Surface any chart artifact created during this turn.
  let recent = await findRecentArtifact(sb, args.conversation_id, args.user_id, turnStartedAt);
  let reply = turn.reply;

  // Fallback determinístico: usuário pediu gráfico/tendência mas o LLM não
  // chamou generate_chart_artifact. Renderiza a média diária acumulada (rota
  // padrão) para não devolver texto genérico. Idempotente pelo findRecent.
  if (!recent?.payload && wantsChart(args.text)) {
    try {
      const kind = pickDeterministicChartKind(args.text);
      const chart = await generate_chart_artifact(
        { sb, user_id: args.user_id, conversation_id: args.conversation_id },
        { kind } as any,
      );
      if (chart.ok) {
        const artifact_id = (chart as any).result?.artifact_id as string | undefined;
        recent = artifact_id ? { artifact_id, payload: (chart as any).result?.artifact } : recent;
        // Reescreve a resposta quando o LLM devolveu texto vazio/redundante.
        if (!reply || /não\s+conseg|não\s+entend/i.test(reply)) {
          reply = kind === "average_daily_trend"
            ? "Gerei o gráfico do seu gasto médio diário acumulado 👇"
            : "Gerei o gráfico com base nos dados reais 👇";
        }
      }
    } catch (e) {
      console.error("[app-adapter] chart_fallback_failed", String((e as Error).message).slice(0, 200));
    }
  }

  if (recent?.payload && !mentionsChart(reply)) {
    reply = `Gerei um gráfico com base nos dados reais 👇\n\n${reply}`;
  }

  await sb.from("conversation_messages").insert({
    conversation_id: args.conversation_id, user_id: args.user_id, direction: "outbound", body_masked: reply,
  } as any);
  await sb.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", args.conversation_id);

  return { reply, pending: pendingOut, executed: null, artifact: recent?.payload ?? null };
}

function mentionsChart(text: string): boolean {
  return /\b(gr[aá]fico|visualiza|abaixo|📊|📈|📉)\b/i.test(text || "");
}

// Amplo: cobre TODO pedido visual/tendência. Se um destes casar, NUNCA
// interceptamos no fast-path textual — deixamos o LLM (ou o fallback) chamar
// generate_chart_artifact. Sincronizado com prompt.ts e com o guardrail server.
export function wantsChart(text: string): boolean {
  return /\b(gr[aá]fico|gr[aá]ficos|graficos?|chart|visualiz(a|ar|a[çc][aã]o)|em\s+barras?|em\s+pizza|em\s+donut|em\s+linhas?|linha|curva|dia\s+a\s+dia|diariamente|por\s+dia|por\s+semana|por\s+m[eê]s|evolu(?:[cç][aã]o|ir|indo)|tend[eê]ncia|m[eé]dia\s+(?:di[aá]ria|do\s+dia|acumulada)|gasto\s+m[eé]dio|estou\s+reduzindo|reduzindo\s+meus?\s+gastos|andando\s+de\s+lado|est[aá]\s+(?:caindo|subindo)|ritmo\s+dos?\s+gastos?)\b/i.test(text || "");
}

// Escolhe o kind determinístico quando o LLM falha. Prioriza a série de média
// acumulada quando o pedido menciona "média", "tendência", "reduzindo" etc.;
// senão cai na série diária bruta ("dia a dia" sem contexto de média).
function pickDeterministicChartKind(text: string): "average_daily_trend" | "timeseries" {
  const t = String(text || "");
  if (/\b(m[eé]dia|tend[eê]ncia|reduzindo|andando\s+de\s+lado|est[aá]\s+(?:caindo|subindo)|ritmo)\b/i.test(t)) {
    return "average_daily_trend";
  }
  return "timeseries";
}

// Estrito: apenas pedidos TEXTUAIS de resumo. "gráfico" e "evolução" saíram —
// esses casos precisam gerar artefato, não texto plano.
function isAnalyticsRequest(text: string): boolean {
  return /\b(me\s+analis[ae]|an[aá]lise\s+geral|resumo\s+(?:do\s+m[eê]s|geral|dos?\s+gastos?)|onde\s+(?:mais\s+)?gast[aeo])\b/i.test(text || "");
}

function analyticsArgs(text: string): { days: number; payment_method?: "account" | "credit_card" } {
  let days = 30;
  const explicit = text.match(/(?:[uú]ltim[oa]s?\s+)?(\d{1,3})\s+dias?/i);
  if (explicit) days = Math.max(1, Math.min(366, Number(explicit[1])));
  else if (/\bhoje\b/i.test(text)) days = 1;
  else if (/\bsemana\b/i.test(text)) days = 7;
  else if (/\b(ano|12 meses)\b/i.test(text)) days = 366;
  else if (/\b(3 meses|trimestre)\b/i.test(text)) days = 90;
  const payment_method = /\bcart[aã]o|fatura|cr[eé]dito\b/i.test(text) ? "credit_card" as const
    : /\bconta|d[eé]bito|pix\b/i.test(text) ? "account" as const : undefined;
  return { days, ...(payment_method ? { payment_method } : {}) };
}

function buildAnalyticsReply(report: any): string {
  if (!report || report.transactions_count === 0) return "Não encontrei lançamentos nesse período. Você pode ampliar o período ou registrar os primeiros gastos.";
  const top = report.top_category
    ? `${report.top_category.name} (${BRL.format(Number(report.top_category.value))})`
    : "nenhuma categoria ainda";
  const sample = report.data_limit === "small_sample" ? " É uma leitura inicial com poucos lançamentos." : "";
  const categoryTip = Number(report.uncategorized || 0) > 0
    ? ` Há ${BRL.format(Number(report.uncategorized))} sem categoria — vale categorizar para melhorar a leitura.`
    : "";
  return `No período, você gastou ${BRL.format(Number(report.totals.expense))}. Onde mais pesou foi ${top}.${sample}${categoryTip}`;
}

async function tryFastPathCardExpense(
  sb: SupabaseClient,
  ctx: { user_id: string; conversation_id: string; text: string },
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<null | { reply: string }> {
  const currentText = ctx.text;
  const nowSpans = extractSpans(currentText);
  const nowHasCard = nowSpans.payment_method === "credit_card" || CARD_KEYWORDS.test(currentText);

  let amount: number | null = nowSpans.amount;
  let cardHint: string | null = nowSpans.card_hint;
  let description: string | undefined = nowSpans.description || undefined;
  let installments_total: number | undefined = nowSpans.installments_total ?? undefined;

  if (amount === null && (nowHasCard || SINGLE_CARD_HINT.test(currentText))) {
    const lastUser = [...history].reverse().find(h => h.role === "user")?.content ?? "";
    const prev = extractSpans(lastUser);
    if (prev.amount !== null) {
      amount = prev.amount;
      cardHint = SINGLE_CARD_HINT.test(currentText) ? "" : (nowSpans.card_hint ?? prev.card_hint);
      description = prev.description || description;
      installments_total = prev.installments_total ?? installments_total;
    }
  }

  if (amount === null) return null;
  if (!nowHasCard && !SINGLE_CARD_HINT.test(currentText) && cardHint === null) return null;

  const resolved = await resolveCreditCardFull({ sb, user_id: ctx.user_id, conversation_id: ctx.conversation_id }, cardHint ?? undefined);
  if (resolved.kind === "none" && resolved.available.length === 0) {
    return { reply: "Você ainda não tem cartão cadastrado. Cadastre um em /app/cartoes e eu registro o gasto em seguida." };
  }
  if (resolved.kind === "multiple") {
    const names = resolved.choices.map(c => `• ${c.name}`).join("\n");
    return { reply: `Você tem mais de um cartão. Qual deles?\n${names}` };
  }

  const argsT: any = { type: "expense" as const, amount, credit_card: cardHint || (resolved as any).name, description };
  if (installments_total && installments_total > 1) argsT.installments_total = installments_total;
  const result = await create_transaction_draft({ sb, user_id: ctx.user_id, conversation_id: ctx.conversation_id }, argsT);
  if (!result.ok) return { reply: "Não consegui preparar esse lançamento. Pode confirmar valor e cartão?" };
  const summary = (result as any).result.summary as string;
  return { reply: `${summary}\nResponda *CONFIRMAR* para registrar ou *CANCELAR* para descartar.` };
}
