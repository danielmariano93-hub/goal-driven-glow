// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
import { round2, type RecurringRow, type TransactionRow } from "./facts.ts";

export type IncomeFrequency = "mensal" | "quinzenal" | "semanal" | "variavel";

export interface FinancialIncomeSettings {
  approximate_monthly_income: number | string | null;
  income_frequency: IncomeFrequency | string | null;
  income_day: number | null;
}

export type FutureIncomeSource = "configured" | "inferred";
export type FutureIncomeConfidence = "low" | "medium" | "high";

export interface FutureIncomeEvent {
  date: string;
  amount: number;
  label: string;
  source: FutureIncomeSource;
  confidence: FutureIncomeConfidence;
  formulaVersion: string;
}

export interface FutureIncomeProjection {
  events: FutureIncomeEvent[];
  total: number;
  source: FutureIncomeSource | null;
  confidence: FutureIncomeConfidence | null;
  formulaVersion: string;
}

export const FUTURE_INCOME_FORMULA_VERSION = "future_income.v1";

type Input = {
  settings?: FinancialIncomeSettings | null;
  txs: TransactionRow[];
  recurring: RecurringRow[];
  today: Date;
  periodEnd: string;
};

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const daysInMonth = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0).getDate();

function dateInMonth(year: number, monthIndex: number, day: number): string {
  return iso(new Date(year, monthIndex, Math.min(Math.max(1, day), daysInMonth(year, monthIndex))));
}

function dayDistance(a: string, b: string): number {
  return Math.abs(new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86_400_000;
}

function amountMatches(a: number, b: number): boolean {
  const tolerance = Math.max(50, Math.max(a, b) * 0.2);
  return Math.abs(a - b) <= tolerance;
}

function explicitIncomeEvents(input: Input): Array<{ date: string; amount: number }> {
  const todayIso = iso(input.today);
  const planned = input.txs
    .filter((t) => t.status === "planned" && t.type === "income" && t.occurred_at >= todayIso && t.occurred_at <= input.periodEnd)
    .map((t) => ({ date: t.occurred_at.slice(0, 10), amount: Number(t.amount || 0) }));
  const recurring = input.recurring
    .filter((r) => r.active && r.type === "income" && r.next_due_date >= todayIso && r.next_due_date <= input.periodEnd)
    .map((r) => ({ date: r.next_due_date.slice(0, 10), amount: Number(r.amount || 0) }));
  return [...planned, ...recurring];
}

function configuredEvents(input: Input): FutureIncomeEvent[] {
  const settings = input.settings;
  const amount = Number(settings?.approximate_monthly_income ?? 0);
  const frequency = settings?.income_frequency as IncomeFrequency | undefined;
  const day = Number(settings?.income_day ?? 0);
  if (!(amount > 0) || day < 1 || day > 31 || frequency === "variavel") return [];

  const year = input.today.getFullYear();
  const month = input.today.getMonth();
  const monthEnd = daysInMonth(year, month);
  let paymentDays: number[] = [];
  if (frequency === "quinzenal") paymentDays = [day, day + 15].map((d) => Math.min(d, monthEnd));
  else if (frequency === "semanal") {
    for (let d = day; d <= monthEnd; d += 7) paymentDays.push(d);
  } else paymentDays = [day];
  paymentDays = [...new Set(paymentDays)].sort((a, b) => a - b);
  const perPayment = round2(amount / Math.max(1, paymentDays.length));
  return paymentDays.map((paymentDay, index) => ({
    date: dateInMonth(year, month, paymentDay),
    amount: index === paymentDays.length - 1 ? round2(amount - perPayment * (paymentDays.length - 1)) : perPayment,
    label: "Renda informada no perfil",
    source: "configured" as const,
    confidence: "high" as const,
    formulaVersion: FUTURE_INCOME_FORMULA_VERSION,
  }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function inferredEvents(input: Input): FutureIncomeEvent[] {
  const history = input.txs.filter((t) => {
    const date = t.occurred_at.slice(0, 10);
    return t.status === "confirmed" && t.type === "income" && date < iso(input.today) && dayDistance(date, iso(input.today)) <= 150;
  });
  const byMonth = new Map<string, TransactionRow[]>();
  for (const row of history) {
    const key = row.occurred_at.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), row]);
  }
  const dominant = [...byMonth.values()].map((rows) => rows.sort((a, b) => Number(b.amount) - Number(a.amount))[0]).filter(Boolean);
  if (dominant.length < 3) return [];
  const amount = round2(median(dominant.map((t) => Number(t.amount || 0))));
  const day = Math.round(median(dominant.map((t) => Number(t.occurred_at.slice(8, 10)))));
  if (!(amount > 0)) return [];
  return [{
    date: dateInMonth(input.today.getFullYear(), input.today.getMonth(), day),
    amount,
    label: "Renda estimada pelo histórico",
    source: "inferred",
    confidence: dominant.length >= 5 ? "medium" : "low",
    formulaVersion: FUTURE_INCOME_FORMULA_VERSION,
  }];
}

/**
 * Estima somente entradas ainda futuras. Lançamentos planejados e recorrências
 * têm precedência; recebimentos confirmados no mesmo ciclo também suprimem a
 * estimativa para impedir dupla contagem.
 */
export function computeFutureIncomeProjection(input: Input): FutureIncomeProjection {
  const todayIso = iso(input.today);
  const explicit = explicitIncomeEvents(input);
  const candidates = configuredEvents(input);
  const selected = candidates.length > 0 ? candidates : inferredEvents(input);
  const confirmed = input.txs
    .filter((t) => t.status === "confirmed" && t.type === "income" && t.occurred_at.slice(0, 7) === todayIso.slice(0, 7))
    .map((t) => ({ date: t.occurred_at.slice(0, 10), amount: Number(t.amount || 0) }));
  const events = selected.filter((event) => {
    if (event.date <= todayIso || event.date > input.periodEnd) return false;
    const duplicate = [...explicit, ...confirmed].some((known) => dayDistance(known.date, event.date) <= 3 && amountMatches(known.amount, event.amount));
    return !duplicate;
  });
  return {
    events,
    total: round2(events.reduce((sum, event) => sum + event.amount, 0)),
    source: events[0]?.source ?? null,
    confidence: events[0]?.confidence ?? null,
    formulaVersion: FUTURE_INCOME_FORMULA_VERSION,
  };
}