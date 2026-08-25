// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Motor de situação das dívidas (`debt_status.v1`).
//
// Responde de forma determinística: alguma parcela vence em breve? alguma
// dívida está em atraso porque o pagamento nunca foi registrado? quanto e por
// quantos dias? A LLM nunca calcula nada disso — apenas explica estes fatos.
//
// Regras contábeis:
//  - a agenda de parcelas nasce de `first_due_date` (ou `start_date` + `due_day`);
//  - "pago" é o que foi REGISTRADO: `installments_paid` na dívida ou a soma de
//    `installments_covered` nos pagamentos — o que for maior;
//  - dívida sem valor de parcela ou sem agenda (`open_balance`,
//    `manual_reconciliation` sem parcela) NÃO gera alarme: fica `indefinido`
//    com confiança `insufficient_data`;
//  - dívida quitada (`status != 'active'` ou saldo zero) sai da conta.

import {
  makeEnvelope,
  makeEvidence,
  type EngineEnvelope,
  type EnginePeriod,
  type EngineConfidence,
} from "./engineEnvelope.ts";
import { round2, type DebtRow } from "./facts.ts";

export const DEBT_STATUS_VERSION = "debt_status.v1";

export interface DebtScheduleRow extends DebtRow {
  installments_total?: number | null;
  installments_paid?: number | null;
  first_due_date?: string | null;
  start_date?: string | null;
  accounting_method?: string | null;
  creditor?: string | null;
}

export interface DebtPaymentRow {
  debt_id: string;
  paid_at: string;
  amount: number;
  amount_applied?: number | null;
  installments_covered?: number | null;
}

export type DebtSituation =
  | "quitada"
  | "em_atraso"
  | "vence_em_breve"
  | "em_dia"
  | "indefinido";

export interface DebtStatusItem {
  debt_id: string;
  name: string;
  creditor: string | null;
  situation: DebtSituation;
  installment_amount: number | null;
  outstanding_balance: number;
  installments_total: number | null;
  installments_paid: number;
  installments_expected: number | null;
  /** Parcelas vencidas e não registradas como pagas. */
  overdue_installments: number;
  overdue_amount: number;
  /** Dias desde o vencimento da parcela vencida mais antiga. */
  days_overdue: number | null;
  next_due_date: string | null;
  days_to_due: number | null;
  last_payment_at: string | null;
  reason: string;
}

export interface DebtStatusFacts {
  debts_analyzed: number;
  overdue_count: number;
  overdue_amount: number;
  due_soon_count: number;
  due_soon_amount: number;
  total_outstanding: number;
  worst: DebtStatusItem | null;
  next_due: DebtStatusItem | null;
  undefined_count: number;
}

export interface DebtStatusInput {
  debts: DebtScheduleRow[];
  payments?: DebtPaymentRow[];
  today: string; // YYYY-MM-DD
  /** Janela de antecipação do aviso de vencimento. */
  dueSoonDays?: number;
}

function daysDiff(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** Vencimento da n-ésima parcela (n = 1 é a primeira) a partir da âncora. */
function dueDateOf(anchor: string, index: number): string {
  const [y, m, d] = anchor.slice(0, 10).split("-").map(Number);
  const targetMonth = (m ?? 1) - 1 + (index - 1);
  const year = (y ?? 1970) + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d ?? 1, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Âncora da agenda (vencimento da 1ª parcela).
 *
 * Ordem de precedência:
 *  1. `first_due_date` informado;
 *  2. `start_date` + `due_day` (contrato com início conhecido);
 *  3. apenas `due_day`: a agenda é DERIVADA do que o usuário declarou —
 *     a parcela nº `covered + 1` é a que vence no `due_day` do ciclo corrente.
 *     Sem isso, uma dívida cadastrada hoje com 18/35 pagas teria o próximo
 *     vencimento projetado 18 meses à frente e nunca acusaria atraso.
 */
function anchorFor(debt: DebtScheduleRow, covered: number, today: string): string | null {
  if (debt.first_due_date) return debt.first_due_date.slice(0, 10);
  const day = Number(debt.due_day ?? 0);
  if (!day) return null;
  if (debt.start_date) {
    const start = debt.start_date.slice(0, 10);
    const [y, m] = start.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
    const anchorDay = Math.min(day, lastDay);
    const candidate = `${y}-${String(m).padStart(2, "0")}-${String(anchorDay).padStart(2, "0")}`;
    // Se o dia de vencimento já passou no mês de início, a 1ª parcela é no mês seguinte.
    return candidate >= start ? candidate : dueDateOf(candidate, 2);
  }
  // Agenda derivada: ciclo corrente = due_day do mês de hoje.
  const [ty, tm] = today.slice(0, 10).split("-").map(Number);
  const lastDay = new Date(Date.UTC(ty ?? 1970, tm ?? 1, 0)).getUTCDate();
  const cycleDue = `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  return dueDateOf(cycleDue, 1 - Math.max(0, covered));
}

function inferredInstallmentsForPayment(debt: DebtScheduleRow, payment: DebtPaymentRow): number {
  const explicit = Math.max(0, Number(payment.installments_covered ?? 0));
  if (explicit > 0) return explicit;
  const installment = Math.max(0, Number(debt.installment_amount ?? 0));
  if (installment <= 0) return 0;
  const applied = Number(payment.amount_applied ?? payment.amount ?? 0);
  if (!Number.isFinite(applied) || applied < installment * 0.95) return 0;
  return Math.max(1, Math.floor(applied / installment));
}

function coveredInstallments(debt: DebtScheduleRow, payments: DebtPaymentRow[]): number {
  const declared = Math.max(0, Number(debt.installments_paid ?? 0));
  const total = debt.installments_total == null ? Number.POSITIVE_INFINITY : Math.max(0, Number(debt.installments_total));
  const fromPayments = payments.reduce((s, p) => s + inferredInstallmentsForPayment(debt, p), 0);
  return Math.min(total, Math.max(declared, fromPayments));
}

function cycleDueForToday(debt: DebtScheduleRow, today: string): string | null {
  const day = Number(debt.due_day ?? 0);
  if (!day || debt.first_due_date || debt.start_date) return null;
  const [ty, tm] = today.slice(0, 10).split("-").map(Number);
  const lastDay = new Date(Date.UTC(ty ?? 1970, tm ?? 1, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function currentCycleCovered(debt: DebtScheduleRow, payments: DebtPaymentRow[], today: string): boolean {
  const cycleDue = cycleDueForToday(debt, today);
  if (!cycleDue) return false;
  const previousCycleDue = dueDateOf(cycleDue, 0);
  return payments.some((p) => {
    if (inferredInstallmentsForPayment(debt, p) <= 0) return false;
    const paidAt = String(p.paid_at ?? "").slice(0, 10);
    return paidAt > previousCycleDue && paidAt <= today;
  });
}

function expectedInstallmentsThrough(anchor: string, today: string, total: number | null): number {
  let expected = 0;
  for (let i = 1; i <= 600; i += 1) {
    const due = dueDateOf(anchor, i);
    if (due > today) break;
    expected = i;
    if (total && i >= total) break;
  }
  return total ? Math.min(expected, total) : expected;
}

function effectiveCoveredInstallments(debt: DebtScheduleRow, payments: DebtPaymentRow[], today: string): number {
  const base = coveredInstallments(debt, payments);
  const total = debt.installments_total == null ? null : Number(debt.installments_total);
  if (!currentCycleCovered(debt, payments, today)) return base;
  const anchor = anchorFor(debt, base, today);
  if (!anchor) return base;
  const expected = expectedInstallmentsThrough(anchor, today, total);
  const cappedTotal = total ?? Number.POSITIVE_INFINITY;
  return expected > base ? Math.min(cappedTotal, base + 1) : base;
}

function evaluateDebt(
  debt: DebtScheduleRow,
  payments: DebtPaymentRow[],
  today: string,
  dueSoonDays: number,
): DebtStatusItem {
  const outstanding = round2(Number(debt.outstanding_balance ?? 0));
  const installment = debt.installment_amount == null ? null : round2(Number(debt.installment_amount));
  const total = debt.installments_total == null ? null : Number(debt.installments_total);
  const covered = effectiveCoveredInstallments(debt, payments, today);
  const lastPayment = payments
    .map((p) => p.paid_at?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort()
    .pop() ?? null;

  const base: DebtStatusItem = {
    debt_id: debt.id,
    name: debt.name,
    creditor: debt.creditor ?? null,
    situation: "indefinido",
    installment_amount: installment,
    outstanding_balance: outstanding,
    installments_total: total,
    installments_paid: covered,
    installments_expected: null,
    overdue_installments: 0,
    overdue_amount: 0,
    days_overdue: null,
    next_due_date: null,
    days_to_due: null,
    last_payment_at: lastPayment,
    reason: "sem agenda de parcelas cadastrada",
  };

  if (String(debt.status) !== "active" || outstanding <= 0) {
    return { ...base, situation: "quitada", reason: "dívida encerrada ou saldo zerado" };
  }

  const anchor = anchorFor(debt, covered, today);
  if (!anchor || !installment || installment <= 0) {
    return base;
  }

  // Parcelas cujo vencimento já passou (limitadas ao total contratado).
  const cappedExpected = expectedInstallmentsThrough(anchor, today, total);

  const overdueCount = Math.max(0, cappedExpected - covered);
  const overdueAmount = round2(Math.min(outstanding, overdueCount * installment));

  const nextIndex = total ? Math.min(covered + 1, total) : covered + 1;
  const nextDue = covered >= (total ?? Number.POSITIVE_INFINITY)
    ? null
    : dueDateOf(anchor, nextIndex);
  const oldestUnpaidDue = overdueCount > 0 ? dueDateOf(anchor, covered + 1) : null;

  // Próximo vencimento futuro (para avisos de "vence em breve").
  let upcoming: string | null = null;
  if (!total || covered < total) {
    for (let i = Math.max(1, covered + 1); i <= (total ?? covered + 24); i += 1) {
      const due = dueDateOf(anchor, i);
      if (due >= today) { upcoming = due; break; }
    }
  }

  const daysToDue = upcoming ? daysDiff(today, upcoming) : null;

  if (overdueCount > 0 && oldestUnpaidDue) {
    return {
      ...base,
      situation: "em_atraso",
      installments_expected: cappedExpected,
      overdue_installments: overdueCount,
      overdue_amount: overdueAmount,
      days_overdue: daysDiff(oldestUnpaidDue, today),
      next_due_date: oldestUnpaidDue,
      days_to_due: null,
      reason: `${overdueCount} parcela(s) vencida(s) sem pagamento registrado`,
    };
  }

  if (daysToDue !== null && daysToDue <= dueSoonDays) {
    return {
      ...base,
      situation: "vence_em_breve",
      installments_expected: cappedExpected,
      next_due_date: upcoming,
      days_to_due: daysToDue,
      reason: daysToDue === 0 ? "parcela vence hoje" : `parcela vence em ${daysToDue} dia(s)`,
    };
  }

  return {
    ...base,
    situation: "em_dia",
    installments_expected: cappedExpected,
    next_due_date: upcoming ?? nextDue,
    days_to_due: daysToDue,
    reason: "pagamentos registrados em dia",
  };
}

export function computeDebtStatus(
  input: DebtStatusInput,
): EngineEnvelope<DebtStatusFacts, DebtStatusItem, DebtStatusItem> {
  const today = input.today.slice(0, 10);
  const dueSoonDays = input.dueSoonDays ?? 7;
  const paymentsByDebt = new Map<string, DebtPaymentRow[]>();
  for (const p of input.payments ?? []) {
    const list = paymentsByDebt.get(p.debt_id) ?? [];
    list.push(p);
    paymentsByDebt.set(p.debt_id, list);
  }

  const items = input.debts
    .map((d) => evaluateDebt(d, paymentsByDebt.get(d.id) ?? [], today, dueSoonDays))
    .filter((i) => i.situation !== "quitada");

  const overdue = items.filter((i) => i.situation === "em_atraso");
  const dueSoon = items.filter((i) => i.situation === "vence_em_breve");
  const undefinedItems = items.filter((i) => i.situation === "indefinido");

  const ordered = [...items].sort((a, b) => {
    const rank = (i: DebtStatusItem) => (i.situation === "em_atraso" ? 0 : i.situation === "vence_em_breve" ? 1 : 2);
    return rank(a) - rank(b)
      || (b.overdue_amount - a.overdue_amount)
      || ((a.days_to_due ?? 999) - (b.days_to_due ?? 999));
  });

  const nextDue = items
    .filter((i) => i.next_due_date && i.situation !== "em_atraso")
    .sort((a, b) => String(a.next_due_date).localeCompare(String(b.next_due_date)))[0] ?? null;

  const facts: DebtStatusFacts = {
    debts_analyzed: items.length,
    overdue_count: overdue.length,
    overdue_amount: round2(overdue.reduce((s, i) => s + i.overdue_amount, 0)),
    due_soon_count: dueSoon.length,
    due_soon_amount: round2(dueSoon.reduce((s, i) => s + (i.installment_amount ?? 0), 0)),
    total_outstanding: round2(items.reduce((s, i) => s + i.outstanding_balance, 0)),
    worst: ordered[0] ?? null,
    next_due: nextDue,
    undefined_count: undefinedItems.length,
  };

  const period: EnginePeriod = { from: today, to: today };
  const scheduled = items.length - undefinedItems.length;
  const confidence: EngineConfidence = items.length === 0
    ? "insufficient_data"
    : scheduled === 0
      ? "insufficient_data"
      : undefinedItems.length === 0
        ? "high"
        : "medium";

  return makeEnvelope({
    engine: "debt_status",
    facts,
    breakdown: ordered,
    drivers: [...overdue, ...dueSoon],
    evidence: makeEvidence({
      period,
      sampleSize: items.length,
      formulaVersion: DEBT_STATUS_VERSION,
      exclusions: [
        "dívidas quitadas ou com saldo zerado",
        "dívidas sem valor de parcela ou sem agenda de vencimento",
      ],
      notes: undefinedItems.length > 0
        ? [`${undefinedItems.length} dívida(s) sem agenda de parcelas — não geram alerta de atraso.`]
        : [],
    }),
    confidence,
  });
}

// ---------------------------------------------------------------------------
// Agenda de parcelas para a UI (mesmo contrato de âncora usado nos alertas).
// ---------------------------------------------------------------------------

export type DebtInstallmentState = "paga" | "vencida" | "proxima" | "a_vencer";

export interface DebtInstallmentRow {
  index: number;
  due_date: string;
  amount: number;
  state: DebtInstallmentState;
}

export interface DebtScheduleView {
  installments: DebtInstallmentRow[];
  installments_paid: number;
  installments_total: number | null;
  paid_amount: number;
  outstanding: number;
  percent_paid: number;
  payoff_date: string | null;
  next_due_date: string | null;
  overdue_count: number;
  derived_schedule: boolean;
  /** Marcos de gamificação já atingidos (25/50/75/100). */
  milestones: number[];
}

export function buildDebtSchedule(
  debt: DebtScheduleRow,
  payments: DebtPaymentRow[],
  today: string,
): DebtScheduleView {
  const day = today.slice(0, 10);
  const covered = effectiveCoveredInstallments(debt, payments, day);
  const installment = debt.installment_amount == null ? null : round2(Number(debt.installment_amount));
  const total = debt.installments_total == null ? null : Number(debt.installments_total);
  const outstanding = round2(Number(debt.outstanding_balance ?? 0));
  const contracted = round2(Number(debt.original_amount ?? 0));
  const paidAmount = round2(Math.max(0, contracted - outstanding));
  // Sem valor contratado conhecido, o progresso honesto é a razão de parcelas cobertas.
  const percent = contracted > 0
    ? Math.min(100, (paidAmount / contracted) * 100)
    : total && total > 0
      ? Math.min(100, (covered / total) * 100)
      : 0;
  const anchor = installment && installment > 0 ? anchorFor(debt, covered, day) : null;

  const rows: DebtInstallmentRow[] = [];
  if (anchor && installment) {
    const count = total ?? Math.max(covered + 12, 12);
    for (let i = 1; i <= Math.min(count, 600); i += 1) {
      const due = dueDateOf(anchor, i);
      const state: DebtInstallmentState = i <= covered
        ? "paga"
        : due < day
          ? "vencida"
          : i === covered + 1
            ? "proxima"
            : "a_vencer";
      rows.push({ index: i, due_date: due, amount: installment, state });
    }
  }

  const pending = rows.filter((r) => r.state !== "paga");
  const milestones = [25, 50, 75, 100].filter((m) => percent >= m);

  return {
    installments: rows,
    installments_paid: covered,
    installments_total: total,
    paid_amount: paidAmount,
    outstanding,
    percent_paid: percent,
    payoff_date: total && rows.length >= total ? rows[total - 1]!.due_date : null,
    next_due_date: pending[0]?.due_date ?? null,
    overdue_count: rows.filter((r) => r.state === "vencida").length,
    derived_schedule: !debt.first_due_date && !debt.start_date && !!debt.due_day,
    milestones,
  };
}
