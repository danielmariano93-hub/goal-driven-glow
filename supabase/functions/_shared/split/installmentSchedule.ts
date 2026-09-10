// split_installment_schedule.v1 — formatação única da agenda de parcelas da
// Divisão do Rolê. Todos os valores e datas vêm PRONTOS da fonte canônica
// (`split_receivables_v1`); nada é recalculado aqui.

export type CanonicalReceivable = {
  installment_id: string;
  installment_number: number;
  total_installments: number;
  amount: number;
  paid_amount: number;
  balance_due: number;
  due_date: string | null;
  settlement_status: string;
  state?: string | null;
  title?: string | null;
};

export function formatBRLSplit(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

/** Data civil sem timezone: "2026-09-30" → "30/09/2026". */
export function formatCivilBR(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export function sortReceivables<T extends { installment_number: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(a.installment_number ?? 0) - Number(b.installment_number ?? 0));
}

export function activeReceivables(rows: CanonicalReceivable[]): CanonicalReceivable[] {
  return sortReceivables(rows.filter((r) => String(r.settlement_status) !== "cancelled"));
}

function stateSuffix(row: CanonicalReceivable): string {
  const status = String(row.settlement_status ?? "");
  const paid = Number(row.paid_amount ?? 0);
  const balance = Math.max(0, Number(row.balance_due ?? 0));
  if (status === "paid" || balance <= 0.004) return " · paga";
  if (paid > 0.004) return ` · parcial, restam *${formatBRLSplit(balance)}*`;
  return "";
}

/**
 * Agenda determinística, uma linha por parcela.
 * `withState` acrescenta o estado (paga / parcial) — usado nas respostas ao
 * participante; o convite sai sem estado porque nada foi pago ainda.
 */
export function buildInstallmentSchedule(
  rows: CanonicalReceivable[],
  opts: { withState?: boolean } = {},
): string {
  const list = activeReceivables(rows);
  if (list.length <= 1) return "";
  return list
    .map((row) => {
      const label = `${row.installment_number}/${row.total_installments}`;
      const due = formatCivilBR(row.due_date);
      const dueText = due ? ` · vence em *${due}*` : "";
      const state = opts.withState ? stateSuffix(row) : "";
      return `• *${label} — ${formatBRLSplit(Number(row.amount ?? 0))}*${dueText}${state}`;
    })
    .join("\n");
}

export type ScheduleSummary = {
  count: number;
  total: number;
  pending_total: number;
  paid_total: number;
  next: CanonicalReceivable | null;
  current_month: CanonicalReceivable[];
};

export function summarizeSchedule(
  rows: CanonicalReceivable[],
  reference: Date = new Date(),
): ScheduleSummary {
  const list = activeReceivables(rows);
  const open = list.filter((r) => Math.max(0, Number(r.balance_due ?? 0)) > 0.004);
  const monthKey = `${reference.getUTCFullYear()}-${String(reference.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    count: list.length,
    total: round2(list.reduce((s, r) => s + Number(r.amount ?? 0), 0)),
    pending_total: round2(open.reduce((s, r) => s + Math.max(0, Number(r.balance_due ?? 0)), 0)),
    paid_total: round2(list.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0)),
    next: open[0] ?? null,
    current_month: open.filter((r) => String(r.due_date ?? "").startsWith(monthKey)),
  };
}

function round2(v: number): number {
  return Math.round(Number(v || 0) * 100) / 100;
}

/** Frase de uma parcela específica: "2/3 de R$ 93,33, com vencimento em 30/10/2026". */
export function installmentSentence(row: CanonicalReceivable): string {
  const due = formatCivilBR(row.due_date);
  const single = Number(row.total_installments ?? 1) <= 1;
  const label = single ? "" : `${row.installment_number}/${row.total_installments} de `;
  const balance = Math.max(0, Number(row.balance_due ?? 0));
  const base = `${label}${formatBRLSplit(balance)}`;
  return due ? `${base}, com vencimento em ${due}` : base;
}
