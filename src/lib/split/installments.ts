// Parcelas da Divisão do Rolê (`split_receivables.v1`).
//
// Espelha, no cliente, a mesma verdade calculada no banco: valor, vencimento,
// pago, saldo e estado da parcela. Datas são SEMPRE civis (`YYYY-MM-DD`) e
// derivadas por aritmética de string — nunca por `new Date(...)` local.

import { civilAddMonths, parseCivilDate } from "@/lib/engine/civilDate";

export const SPLIT_INSTALLMENTS_VERSION = "split_receivables.v1";

export type InstallmentDraft = { amount: number; due_date: string };

export type ReceivableRow = {
  installment_id: string;
  shared_expense_id: string;
  participant_id: string;
  participant_name: string;
  installment_number: number;
  total_installments: number;
  amount: number;
  paid_amount: number;
  balance_due: number;
  due_date: string | null;
  settlement_status: "pending" | "partial" | "paid" | "cancelled";
  state: InstallmentState;
};

export type InstallmentState = "pending" | "partial" | "paid" | "overdue" | "cancelled";

export const INSTALLMENT_STATE_LABEL: Record<InstallmentState, string> = {
  paid: "Pago",
  partial: "Pago em parte",
  overdue: "Atrasado",
  pending: "A pagar",
  cancelled: "Cancelado",
};

/** Hoje em data civil no fuso de São Paulo (mesma referência do banco). */
export function todayCivilSaoPaulo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

/** Mesma regra do `public.split_installment_state`. */
export function installmentState(row: {
  settlement_status?: string | null;
  status?: string | null;
  due_date?: string | null;
  amount: number;
  paid_amount: number;
}, today = todayCivilSaoPaulo()): InstallmentState {
  const status = String(row.settlement_status ?? row.status ?? "pending");
  if (status === "cancelled") return "cancelled";
  if (Number(row.paid_amount ?? 0) >= Number(row.amount ?? 0)) return "paid";
  if (row.due_date && row.due_date < today) return "overdue";
  if (Number(row.paid_amount ?? 0) > 0) return "partial";
  return "pending";
}

/** Divide em parcelas iguais distribuindo os centavos residuais nas primeiras. */
export function equalInstallmentAmounts(total: number, count: number): number[] {
  if (!(total > 0)) throw new Error("total inválido");
  if (!Number.isInteger(count) || count < 1) throw new Error("quantidade inválida");
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  let rest = cents - base * count;
  return Array.from({ length: count }, () => {
    const extra = rest > 0 ? 1 : 0;
    rest = Math.max(0, rest - 1);
    return (base + extra) / 100;
  });
}

/** Vencimentos mensais a partir do primeiro, com clamp de fim de mês. */
export function monthlyDueDates(firstDue: string, count: number): string[] {
  if (!parseCivilDate(firstDue)) return Array.from({ length: count }, () => firstDue);
  return Array.from({ length: count }, (_, i) => (i === 0 ? firstDue : civilAddMonths(firstDue, i)));
}

export function buildEqualInstallments(total: number, count: number, firstDue: string): InstallmentDraft[] {
  const amounts = equalInstallmentAmounts(total, count);
  const dates = monthlyDueDates(firstDue, count);
  return amounts.map((amount, i) => ({ amount, due_date: dates[i]! }));
}

export function installmentsSum(rows: InstallmentDraft[]): number {
  return rows.reduce((sum, r) => sum + Math.round(Number(r.amount || 0) * 100), 0) / 100;
}

/** Valida se as parcelas fecham exatamente com o total da pessoa. */
export function validateInstallments(total: number, rows: InstallmentDraft[]): {
  ok: boolean; sum: number; remaining: number;
} {
  const sum = installmentsSum(rows);
  const remaining = Math.round((total - sum) * 100) / 100;
  return { ok: remaining === 0 && rows.length > 0, sum, remaining };
}

export function installmentLabel(number: number, total: number): string {
  return total <= 1 ? "parcela única" : `${number}ª parcela de ${total}`;
}

export type ReceivablesSummary = {
  total: number;
  received: number;
  pending: number;
  overdue: number;
  nextDueDate: string | null;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
};

/** Consolidação canônica: valor do rolê nunca se confunde com saldo a receber. */
export function summarizeReceivables(rows: ReceivableRow[], today = todayCivilSaoPaulo()): ReceivablesSummary {
  const active = rows.filter((r) => r.settlement_status !== "cancelled");
  let total = 0, received = 0, pending = 0, overdue = 0;
  let paidCount = 0, pendingCount = 0, overdueCount = 0;
  let nextDueDate: string | null = null;
  for (const row of active) {
    const state = row.state ?? installmentState(row, today);
    total += Number(row.amount ?? 0);
    received += Number(row.paid_amount ?? 0);
    const balance = Math.max(0, Number(row.balance_due ?? row.amount - row.paid_amount));
    if (state === "paid") { paidCount += 1; continue; }
    if (state === "overdue") { overdue += balance; overdueCount += 1; }
    else { pending += balance; pendingCount += 1; }
    if (balance > 0 && row.due_date && (!nextDueDate || row.due_date < nextDueDate)) nextDueDate = row.due_date;
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    total: round(total), received: round(received), pending: round(pending), overdue: round(overdue),
    nextDueDate, paidCount, pendingCount, overdueCount,
  };
}

export function formatCivil(date: string | null | undefined): string {
  const d = parseCivilDate(String(date ?? ""));
  if (!d) return "";
  return `${String(d.day).padStart(2, "0")}/${String(d.month).padStart(2, "0")}/${d.year}`;
}
