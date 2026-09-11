// ConfirmationFastPath (`nino_confirmation.v1`) — uma confirmação pendente é
// ESTADO, não linguagem aberta.
//
// Fluxo: INBOUND → SESSION → PENDING → CLASSIFICADOR → EXECUÇÃO → RECIBO.
// Roda ANTES de IntentRouter completo, Human Understanding, ContextPipeline,
// diagnóstico, Semantic IR, prompt e ActionPlanner. Zero chamadas de modelo.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { findPending, confirmationExecutor, type PendingRow } from "./PendingConfirmations.ts";
import { confirmAndBuildReceipt } from "./ConfirmAndReceipt.ts";
import { classifyConfirmationAct, type ConfirmationAct } from "./ConfirmationVocabulary.ts";

export type PendingState = "fresh" | "expired" | "confirmed" | "cancelled" | "none";

/**
 * Janela em que um rascunho já resolvido/expirado ainda explica um "sim"/"não"
 * curto. Fora dela, a palavra pertence à conversa, não à confirmação.
 */
export const RECENT_PENDING_WINDOW_MS = 30 * 60 * 1000;


export type FastPathOutcome = {
  handled: boolean;
  reply: string;
  reply_kind: "receipt" | "info" | "expired" | "cancelled" | "question";
  act: ConfirmationAct | null;
  pending_state: PendingState;
  pending_id: string | null;
  pending_kind: string | null;
  execution_ms: number;
  llm_calls: 0;
  tokens: 0;
  error: string | null;
};

const idle = (extra: Partial<FastPathOutcome> = {}): FastPathOutcome => ({
  handled: false, reply: "", reply_kind: "info", act: null, pending_state: "none",
  pending_id: null, pending_kind: null, execution_ms: 0, llm_calls: 0, tokens: 0,
  error: null, ...extra,
});

/**
 * Estado real da última pendência da conversa, incluindo expirada, confirmada e
 * cancelada — `findPending` por definição só vê as frescas.
 */
export async function resolvePendingState(
  sb: SupabaseClient,
  conversation_id: string,
  user_id: string,
): Promise<{ state: PendingState; row: PendingRow | null }> {
  const fresh = await findPending(sb, conversation_id, user_id);
  if (fresh) return { state: "fresh", row: fresh };

  const { data } = await sb.from("pending_confirmations")
    .select("id, kind, payload, summary_text, status, expires_at, user_id, conversation_id")
    .eq("conversation_id", conversation_id)
    .eq("user_id", user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data as PendingRow | null) ?? null;
  if (!row) return { state: "none", row: null };
  const status = String(row.status ?? "");
  if (status === "confirmed" || status === "executed" || status === "done") return { state: "confirmed", row };
  if (status === "cancelled") return { state: "cancelled", row };
  if (status === "pending" && new Date(row.expires_at).getTime() <= Date.now()) return { state: "expired", row };
  if (status === "expired") return { state: "expired", row };
  return { state: "none", row };
}

/**
 * Resolve o turno quando ele é apenas um "sim"/"não" sobre uma operação já
 * montada. Devolve `handled: false` quando o pipeline normal deve continuar.
 */
export async function runConfirmationFastPath(
  sb: SupabaseClient,
  args: {
    user_id: string;
    conversation_id: string;
    inbound_message_id: string | null;
    text: string;
  },
): Promise<FastPathOutcome> {
  const act = classifyConfirmationAct(args.text);
  if (act === "unrelated") return idle();

  const { state, row } = await resolvePendingState(sb, args.conversation_id, args.user_id);

  // Lote colado (`bulk_transactions`) tem executor próprio em TypeScript.
  // Deixa o caminho de lote resolver — nunca duplicamos executor.
  if (row?.kind === "bulk_transactions") {
    return idle({ pending_state: state, pending_id: row.id, pending_kind: row.kind, act });
  }

  // Sem rascunho fresco o fast path NÃO pode engolir o turno: "sim", "pode",
  // "tudo certo" também são respostas a perguntas do Nino (check-in emocional,
  // "quer ver o resumo?"). Só respondemos de forma determinística quando existe
  // um rascunho recente cujo estado explica a confirmação; fora disso o
  // pipeline normal continua.
  if (state !== "fresh" || !row) {
    if (act === "ambiguous") return idle({ pending_state: state, act });
    const referenceAt = row ? new Date(row.expires_at).getTime() : 0;
    const recent = Boolean(row) && Number.isFinite(referenceAt) &&
      Date.now() - referenceAt < RECENT_PENDING_WINDOW_MS;
    if (!row || !recent || state === "none") {
      return idle({
        pending_state: state, act,
        pending_id: row?.id ?? null, pending_kind: row?.kind ?? null,
      });
    }
    const reply =
      state === "expired"
        ? "Esse rascunho já expirou por aqui. Me manda de novo que eu monto na hora."
        : state === "confirmed"
        ? "Esse lançamento já está salvo. Não precisa confirmar de novo. ✅"
        : "Esse rascunho foi cancelado. Se quiser registrar, me conta de novo.";
    return {
      handled: true, reply,
      reply_kind: state === "expired" ? "expired" : "info",
      act, pending_state: state, pending_id: row.id, pending_kind: row.kind,
      execution_ms: 0, llm_calls: 0, tokens: 0, error: null,
    };
  }


  // Ambíguo com rascunho vivo: pergunta. Nunca escreve por palpite.
  if (act === "ambiguous") {
    return {
      handled: true,
      reply: "Só pra eu não errar: posso salvar assim mesmo? Responde “salvar” ou “cancelar”.",
      reply_kind: "question", act, pending_state: state,
      pending_id: row.id, pending_kind: row.kind, execution_ms: 0, llm_calls: 0, tokens: 0, error: null,
    };
  }

  if (act === "cancel") {
    const started = Date.now();
    // Transição atômica: só o primeiro "cancela" muda o estado; o segundo
    // recebe resposta idempotente coerente, nunca erro.
    const { data: cancelled } = await sb.from("pending_confirmations")
      .update({ status: "cancelled" })
      .eq("id", row.id).eq("status", "pending")
      .select("id");
    const first = Array.isArray(cancelled) ? cancelled.length > 0 : !!cancelled;
    return {
      handled: true,
      reply: first
        ? "Combinado, cancelei este pedido. Se mudar de ideia, é só me contar de novo. 🙂"
        : "Esse pedido já estava cancelado por aqui. Nada foi salvo. 🙂",
      reply_kind: "cancelled", act, pending_state: state,
      pending_id: row.id, pending_kind: row.kind,
      execution_ms: Date.now() - started, llm_calls: 0, tokens: 0, error: null,
    };
  }

  // Guarda contra negação falsa de capability: só chegamos aqui com executor.
  if (!confirmationExecutor(row.kind)) {
    return idle({ pending_state: state, pending_id: row.id, pending_kind: row.kind, act });
  }

  const started = Date.now();
  const outcome = await confirmAndBuildReceipt(sb, row, {
    source_message_id: args.inbound_message_id ?? null,
  });
  return {
    handled: true,
    reply: outcome.reply,
    reply_kind: outcome.reply_kind === "expired" ? "expired" : outcome.reply_kind,
    act, pending_state: state, pending_id: row.id, pending_kind: row.kind,
    execution_ms: Date.now() - started, llm_calls: 0, tokens: 0,
    error: outcome.error,
  };
}

/** Frases proibidas quando existe pendência com executor disponível. */
const FALSE_DENIAL_RX =
  /(n[ãa]o consigo (?:confirmar|salvar|registrar|lan[çc]ar))|(n[ãa]o posso (?:confirmar|salvar|registrar))|(finalize pelo app)|(conclua pelo aplicativo)|(n[ãa]o d[áa] pra (?:salvar|confirmar) por aqui)/i;

/**
 * Bloqueia negação falsa de capability. Só é permitida quando o executor foi
 * chamado E falhou de verdade.
 */
export function isFalseCapabilityDenial(args: {
  reply: string;
  has_pending: boolean;
  executor_available: boolean;
  executor_called: boolean;
  executor_failed: boolean;
}): boolean {
  if (!args.has_pending || !args.executor_available) return false;
  if (args.executor_called && args.executor_failed) return false;
  return FALSE_DENIAL_RX.test(String(args.reply ?? ""));
}
