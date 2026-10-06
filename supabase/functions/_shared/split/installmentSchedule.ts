// split_installment_schedule.v1 — formatação única da agenda de parcelas da
// Divisão do Rolê. Todos os valores e datas vêm PRONTOS da fonte canônica
// (`split_receivables_v1`); nada é recalculado aqui.


import { civilAddMonths } from "../finance-core/civilDate.ts";
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

/**
 * Mensagem de confirmação de pagamento (`payment_confirmation`): diz o que foi
 * recebido, mostra a situação de TODAS as parcelas e o que falta, sem prometer
 * lembretes (eles podem estar pausados) e sem mencionar atraso.
 * Tudo vem pronto da fonte canônica; nada é recalculado.
 * Devolve `null` quando não há parcelas para descrever (usa-se o texto antigo).
 */
export function buildPaymentConfirmationParts(
  rows: CanonicalReceivable[],
  paidInstallmentId: string | null | undefined,
  ctx: { title: string; ownerName: string },
): { headline: string; scheduleBlock: string; closing: string } | null {
  const list = activeReceivables(rows);
  if (list.length === 0) return null;
  const row = list.find((r) => r.installment_id === paidInstallmentId) ?? null;
  if (!row) return null;
  const multi = list.length > 1;
  const where = `da divisão “${ctx.title}” com ${ctx.ownerName}`;
  const balanceOf = (r: CanonicalReceivable) => Math.max(0, Number(r.balance_due ?? 0));
  const isOpen = (r: CanonicalReceivable) => balanceOf(r) > 0.004;
  const open = list.filter(isOpen);
  const remainingTotal = round2(open.reduce((sum, r) => sum + balanceOf(r), 0));

  const rowFullyPaid = !isOpen(row);
  const amount = formatBRLSplit(Number(row.amount ?? 0));
  let headline: string;
  if (rowFullyPaid) {
    headline = multi
      ? `Recebemos o pagamento da *${row.installment_number}ª parcela (${amount})* ${where}. Obrigado! 🙌`
      : `Recebemos o pagamento da sua parte (*${amount}*) ${where}. Obrigado! 🙌`;
  } else {
    const due = formatCivilBR(row.due_date);
    headline = `Recebemos um pagamento ${multi ? `na *${row.installment_number}ª parcela* ` : "da sua parte "}${where}: ` +
      `já foram pagos *${formatBRLSplit(Number(row.paid_amount ?? 0))}* e restam *${formatBRLSplit(balanceOf(row))}*` +
      `${due ? `, com vencimento em *${due}*` : ""}. Obrigado! 🙌`;
  }

  const scheduleBlock = multi
    ? "\n\n*Como está sua divisão:*\n" + list.map((r) => {
        const label = `${r.installment_number}/${r.total_installments}`;
        const value = formatBRLSplit(Number(r.amount ?? 0));
        if (!isOpen(r)) return `✅ ${label} — ${value} — paga`;
        const due = formatCivilBR(r.due_date);
        const partial = Number(r.paid_amount ?? 0) > 0.004
          ? `restam *${formatBRLSplit(balanceOf(r))}*${due ? `, vence em *${due}*` : ""}`
          : due ? `vence em *${due}*` : "em aberto";
        return `⏳ ${label} — ${value} — ${partial}`;
      }).join("\n")
    : "";

  let closing: string;
  if (open.length === 0) {
    closing = multi
      ? "\n\nEssa foi a última parcela: você está em dia com essa divisão. 🎉"
      : "\n\nVocê está em dia com essa divisão. 🎉";
  } else if (multi) {
    const next = open[0];
    const nextDue = formatCivilBR(next.due_date);
    closing = `\n\nFalta *${formatBRLSplit(remainingTotal)}* no total${nextDue ? `; a próxima parcela vence em *${nextDue}*` : ""}.`;
  } else {
    closing = "";
  }
  return { headline, scheduleBlock, closing };
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

// ---- Rascunho de parcelas (paridade com o app) ----
// Mesma aritmética de `src/lib/split/installments.ts`: centavos residuais nas
// primeiras parcelas e vencimentos mensais em data civil.

export type InstallmentDraftRow = { amount: number; due_date: string };

export function equalInstallmentAmounts(total: number, count: number): number[] {
  const cents = Math.round(Number(total) * 100);
  const base = Math.floor(cents / count);
  let rest = cents - base * count;
  return Array.from({ length: count }, () => {
    const extra = rest > 0 ? 1 : 0;
    rest = Math.max(0, rest - 1);
    return (base + extra) / 100;
  });
}

export function buildEqualInstallmentDrafts(
  total: number,
  count: number,
  firstDue: string,
): InstallmentDraftRow[] {
  return equalInstallmentAmounts(total, count).map((amount, i) => ({
    amount,
    due_date: i === 0 ? firstDue : civilAddMonths(firstDue, i),
  }));
}

export function installmentsSum(rows: InstallmentDraftRow[]): number {
  return rows.reduce((s, r) => s + Math.round(Number(r.amount || 0) * 100), 0) / 100;
}
