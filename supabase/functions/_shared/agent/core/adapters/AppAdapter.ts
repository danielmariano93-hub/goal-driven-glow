// AppAdapter — routes in-app assessor turns through the shared AgentCore
// while preserving only UI-specific confirm/cancel action buttons. Free-text
// reasoning and tool routing are intentionally identical across channels.
//
// The HTTP wrapper (agent-chat/index.ts) only handles auth, rate limit,
// conversation lookup and the JSON contract; every decision the agent
// makes lives here or deeper in the Core.
// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleTurn, type HandleTurnResult } from "../AgentCore.ts";
import { evaluate as evaluatePolicy } from "../PolicyEngine.ts";
import { routeIntent } from "../IntentRouter.ts";
import { buildReceipt } from "../ReceiptBuilder.ts";
import { confirmationExecutor } from "../PendingConfirmations.ts";
import { findBulkPending, executeBulkPending } from "../BulkEntry.ts";

import { generate_chart_artifact } from "../../tools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export type AppTurnResult = {
  reply: string;
  pending: { id: string; kind: string; summary_text: string; payload: any; expires_at: string } | null;
  executed: any;
  report?: any;
  artifact?: any;
  envelope?: HandleTurnResult["envelope"];
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

  // Lote (kind bulk_transactions) é executado em TypeScript, não pela RPC.
  const bulkPending = await findBulkPending(sb, args.conversation_id, args.user_id, args.pending_id);
  if (bulkPending) {
    let replyBulk: string;
    if (args.action === "cancel") {
      await sb.from("pending_confirmations").update({ status: "cancelled" } as any).eq("id", bulkPending.id);
      replyBulk = "Combinado, descartei essa lista de lançamentos.";
    } else {
      replyBulk = (await executeBulkPending(sb, bulkPending)).reply;
    }
    await sb.from("conversation_messages").insert({
      conversation_id: args.conversation_id, user_id: args.user_id, direction: "outbound", body_masked: replyBulk,
    } as any);
    await sb.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", args.conversation_id);
    return { reply: replyBulk, pending: null, executed: null };
  }

  const pending = await findPendingApp(sb, args.conversation_id, args.user_id, args.pending_id);
  let reply = "";
  let executed: any = null;

  if (!pending) {
    reply = "Não encontrei nada pendente. Me conte o que você quer registrar.";
  } else if (args.action === "cancel") {
    await sb.from("pending_confirmations").update({ status: "cancelled" } as any).eq("id", pending.id);
    reply = "Combinado, cancelei este pedido.";
  } else {

    const { data: exec, error: execErr } = await sb.rpc(confirmationExecutor(pending.kind), {
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
    const bulkPending = await findBulkPending(sb, args.conversation_id, args.user_id);
    if (bulkPending) {
      let bulkReply: string;
      if (routed.intent.kind === "cancel") {
        await sb.from("pending_confirmations").update({ status: "cancelled" } as any).eq("id", bulkPending.id);
        bulkReply = "Combinado, descartei essa lista de lançamentos.";
      } else {
        bulkReply = (await executeBulkPending(sb, bulkPending)).reply;
      }
      await sb.from("conversation_messages").insert({
        conversation_id: args.conversation_id, user_id: args.user_id, direction: "outbound", body_masked: bulkReply,
      } as any);
      await sb.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", args.conversation_id);
      return { reply: bulkReply, pending: null, executed: null };
    }
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

  // Every free-text turn goes through the same capability router and Core as
  // WhatsApp. Channel-specific analytics/card shortcuts caused divergent
  // answers and bypassed the unified telemetry/grounding contract.
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

  const outboundRow: Record<string, any> = {
    conversation_id: args.conversation_id, user_id: args.user_id, direction: "outbound", body_masked: reply,
  };
  if (recent?.artifact_id) outboundRow.artifact_ids = [recent.artifact_id];
  await sb.from("conversation_messages").insert(outboundRow as any);
  await sb.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", args.conversation_id);

  return { reply, pending: pendingOut, executed: null, artifact: recent?.payload ?? null, envelope: turn.envelope };
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
