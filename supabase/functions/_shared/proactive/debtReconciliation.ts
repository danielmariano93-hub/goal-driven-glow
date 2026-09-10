// deno-lint-ignore-file no-explicit-any
// debt_obligation_truth.v1 — reconciliação de obrigações já pagas.
// ==========================================================================
// Idempotente e sem identificador fixo de usuário: encerra situações,
// sugestões e antecipações de ciclos que a fonte canônica já dá como pagos.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isOverdue, loadDebtObligations, type DebtObligation } from "./debtObligations.ts";

export type DebtReconciliationResult = {
  checked: number;
  paid: number;
  situations_closed: number;
  suggestions_closed: number;
  anticipations_closed: number;
  available: boolean;
};

/** Obrigações que não podem mais gerar cobrança. */
export function settledObligations(obligations: DebtObligation[]): DebtObligation[] {
  return obligations.filter((o) => o.cycle_status === "paid" && !isOverdue(o));
}

/** Casamento por identificador canônico em qualquer profundidade da evidência. */
export function mentionsDebt(payload: unknown, debtIds: Set<string>): boolean {
  const raw = JSON.stringify(payload ?? {});
  for (const id of debtIds) if (id && raw.includes(id)) return true;
  return false;
}

const DEBT_SUGGESTION_KINDS = ["debt_overdue", "debt_due_soon", "debt_installment_due"];

export async function reconcilePaidDebtCommunications(
  sb: SupabaseClient,
  userId: string,
  asOf: string,
): Promise<DebtReconciliationResult> {
  const result: DebtReconciliationResult = {
    checked: 0, paid: 0, situations_closed: 0, suggestions_closed: 0, anticipations_closed: 0, available: true,
  };
  const { obligations, available } = await loadDebtObligations(sb, userId, asOf);
  result.available = available;
  result.checked = obligations.length;
  if (!available || obligations.length === 0) return result;

  const settled = settledObligations(obligations);
  result.paid = settled.length;
  if (settled.length === 0) return result;
  const debtIds = new Set(settled.map((o) => o.debt_id).filter(Boolean));
  if (debtIds.size === 0) return result;

  // 1) Situações de dívida ainda abertas (o id vive na chave ou na avaliação).
  const { data: situations } = await sb.from("financial_situations")
    .select("id,situation_type,situation_key,evaluation,status")
    .eq("user_id", userId)
    .in("status", ["observed", "confirmed", "active", "improving", "worsening"]);
  const staleSituations = ((situations as any[]) ?? [])
    .filter((row) => /debt/i.test(String(row.situation_type ?? "")) || /debt/i.test(String(row.situation_key ?? "")))
    .filter((row) => mentionsDebt({ key: row.situation_key, evaluation: row.evaluation }, debtIds));
  if (staleSituations.length > 0) {
    const { error } = await sb.from("financial_situations")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .in("id", staleSituations.map((row) => row.id));
    if (!error) result.situations_closed = staleSituations.length;
  }

  // 2) Sugestões proativas pendentes do mesmo assunto.
  const { data: suggestions } = await sb.from("pending_proactive_suggestions")
    .select("id,kind,evidence,status")
    .eq("user_id", userId)
    .in("status", ["pending", "deferred", "awaiting_approval"])
    .in("kind", DEBT_SUGGESTION_KINDS);
  const staleSuggestions = ((suggestions as any[]) ?? []).filter((row) => mentionsDebt(row.evidence, debtIds));
  if (staleSuggestions.length > 0) {
    const { error } = await sb.from("pending_proactive_suggestions")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        defer_reason: "obligation_already_paid",
        next_attempt_at: null,
      })
      .in("id", staleSuggestions.map((row) => row.id));
    if (!error) result.suggestions_closed = staleSuggestions.length;
  }

  // 3) Antecipações agendadas para cobrar uma obrigação já paga.
  const { data: anticipations } = await sb.from("anticipation_opportunities")
    .select("id,kind,evidence,status")
    .eq("user_id", userId)
    .in("status", ["scheduled", "revalidating", "ready"]);
  const staleAnticipations = ((anticipations as any[]) ?? [])
    .filter((row) => /debt|divida|dívida/i.test(String(row.kind ?? "")))
    .filter((row) => mentionsDebt(row.evidence, debtIds));
  if (staleAnticipations.length > 0) {
    const { error } = await sb.from("anticipation_opportunities")
      .update({ status: "cancelled", suppress_reason: "obligation_already_paid" })
      .in("id", staleAnticipations.map((row) => row.id));
    if (!error) result.anticipations_closed = staleAnticipations.length;
  }

  return result;
}
