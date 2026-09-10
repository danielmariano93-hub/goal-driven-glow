// deno-lint-ignore-file no-explicit-any
// debt_obligation_truth.v1 — camada única de obrigações de dívida.
// ==========================================================================
// NADA é calculado aqui. Toda informação vem da fonte canônica
// `debt_obligation_state` (ciclo, pagamento, próximo vencimento, atraso).
// O motor proativo não reconstrói vencimento por dia do mês nunca mais.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const DEBT_OBLIGATION_TRUTH_VERSION = "debt_obligation_truth.v1";

export type DebtCycleStatus = "paid" | "pending" | "partial" | "unknown";

export type DebtObligation = {
  debt_id: string;
  name: string;
  creditor: string | null;
  installment_amount: number;
  outstanding: number;
  /** `em_dia` | `em_atraso` | outro valor canônico. */
  situation: string;
  cycle_status: DebtCycleStatus;
  cycle_due_date: string | null;
  cycle_paid_at: string | null;
  cycle_paid_amount: number;
  next_due_date: string | null;
  /** Dias até o vencimento relevante (negativo = passado). */
  days_until: number | null;
  days_overdue: number | null;
  overdue_amount: number;
  overdue_installments: number;
  canonical_source: string;
  formula_version: string;
};

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cycleStatusOf(value: unknown): DebtCycleStatus {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "paid" || raw === "pending" || raw === "partial") return raw;
  return "unknown";
}

export function mapDebtObligationRow(row: Record<string, unknown>): DebtObligation {
  const daysOverdue = row.days_overdue == null ? null : Number(row.days_overdue);
  const daysToDue = row.days_to_due == null ? null : Number(row.days_to_due);
  return {
    debt_id: String(row.debt_id ?? ""),
    name: String(row.name ?? "Dívida"),
    creditor: row.creditor == null ? null : String(row.creditor),
    installment_amount: num(row.installment_amount),
    outstanding: num(row.outstanding),
    situation: String(row.situation ?? "em_dia"),
    cycle_status: cycleStatusOf(row.current_cycle_status),
    cycle_due_date: row.current_cycle_due_date == null ? null : String(row.current_cycle_due_date),
    cycle_paid_at: row.current_cycle_paid_at == null ? null : String(row.current_cycle_paid_at),
    cycle_paid_amount: num(row.current_cycle_paid_amount),
    next_due_date: row.next_due_date == null ? null : String(row.next_due_date),
    days_until: daysOverdue != null && daysOverdue > 0 ? -daysOverdue : daysToDue,
    days_overdue: daysOverdue,
    overdue_amount: num(row.overdue_amount),
    overdue_installments: Number(row.overdue_installments ?? 0),
    canonical_source: "debt_obligation_state",
    formula_version: String(row.formula_version ?? "debt_obligation.v1"),
  };
}

export async function loadDebtObligations(
  sb: SupabaseClient,
  userId: string,
  asOf: string,
): Promise<{ obligations: DebtObligation[]; available: boolean }> {
  try {
    const { data, error } = await sb.rpc("debt_obligation_state", {
      _user_id: userId,
      _as_of: asOf,
      _due_soon_days: 7,
    });
    if (error) return { obligations: [], available: false };
    const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    return { obligations: rows.map(mapDebtObligationRow), available: true };
  } catch {
    return { obligations: [], available: false };
  }
}

/** Atraso é afirmação da fonte canônica — nunca dedução de "faltam 0 dias". */
export function isOverdue(o: DebtObligation): boolean {
  return o.situation === "em_atraso" || (o.days_overdue ?? 0) > 0;
}

/**
 * Ciclo pago não gera comunicação nenhuma. Só entram atraso confirmado ou
 * ciclo ainda em aberto dentro da janela de 7 dias.
 */
export function shouldAlert(o: DebtObligation): boolean {
  if (o.installment_amount <= 0) return false;
  if (isOverdue(o)) return true;
  if (o.cycle_status === "paid") return false;
  const days = o.days_until;
  return days != null && days >= 0 && days <= 7;
}

/** Linguagem de prazo em pt-BR: nunca "dia(s)". */
export function dueWording(daysUntil: number | null): string {
  if (daysUntil == null) return "com vencimento a definir";
  if (daysUntil === 0) return "vence hoje";
  if (daysUntil === 1) return "vence amanhã";
  if (daysUntil > 1) return `vence em ${daysUntil} dias`;
  if (daysUntil === -1) return "venceu ontem";
  return `está ${Math.abs(daysUntil)} dias em atraso`;
}

/** Data civil pt-BR a partir de uma data ISO, sem deslocamento de fuso. */
export function civilDateBR(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return `${match[3]}/${match[2]}`;
}
