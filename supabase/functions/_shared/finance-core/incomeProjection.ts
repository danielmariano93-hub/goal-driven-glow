// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
import { round2, type RecurringRow, type TransactionRow } from "./facts.ts";

export type IncomeFrequency = "mensal" | "quinzenal" | "semanal" | "variavel";
export interface FinancialIncomeSettings { approximate_monthly_income: number | string | null; income_frequency: IncomeFrequency | string | null; income_day: number | null; }
export type FutureIncomeSource = "configured" | "inferred";
export type FutureIncomeConfidence = "low" | "medium" | "high";
export interface FutureIncomeEvent { date: string; amount: number; label: string; source: FutureIncomeSource; confidence: FutureIncomeConfidence; formulaVersion: string; }
export interface FutureIncomeProjection { events: FutureIncomeEvent[]; total: number; source: FutureIncomeSource | null; confidence: FutureIncomeConfidence | null; formulaVersion: string; }
export const FUTURE_INCOME_FORMULA_VERSION = "future_income.v1";
type Input = { settings?: FinancialIncomeSettings | null; txs: TransactionRow[]; recurring: RecurringRow[]; today: Date; periodEnd: string; };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysInMonth = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0).getDate();
const dateInMonth = (year: number, monthIndex: number, day: number) => iso(new Date(year, monthIndex, Math.min(Math.max(1, day), daysInMonth(year, monthIndex))));
const dayDistance = (a: string, b: string) => Math.abs(new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86_400_000;
const amountMatches = (a: number, b: number) => Math.abs(a - b) <= Math.max(50, Math.max(a, b) * 0.2);
function explicitIncomeEvents(input: Input) {
  const todayIso = iso(input.today);
  return [
    ...input.txs.filter((t) => t.status === "planned" && t.type === "income" && t.occurred_at >= todayIso && t.occurred_at <= input.periodEnd).map((t) => ({ date: t.occurred_at.slice(0, 10), amount: Number(t.amount || 0) })),
    ...input.recurring.filter((r) => r.active && r.type === "income" && r.next_due_date >= todayIso && r.next_due_date <= input.periodEnd).map((r) => ({ date: r.next_due_date.slice(0, 10), amount: Number(r.amount || 0) })),
  ];
}
function configuredEvents(input: Input): FutureIncomeEvent[] {
  const amount = Number(input.settings?.approximate_monthly_income ?? 0);
  const frequency = input.settings?.income_frequency as IncomeFrequency | undefined;
  const day = Number(input.settings?.income_day ?? 0);
  if (!(amount > 0) || day < 1 || day > 31 || frequency === "variavel") return [];
  const year = input.today.getFullYear(), month = input.today.getMonth(), monthEnd = daysInMonth(year, month);
  let paymentDays: number[] = frequency === "quinzenal" ? [day, day + 15].map((d) => Math.min(d, monthEnd)) : frequency === "semanal" ? [] : [day];
  if (frequency === "semanal") for (let d = day; d <= monthEnd; d += 7) paymentDays.push(d);
  paymentDays = [...new Set(paymentDays)].sort((a, b) => a - b);
  const perPayment = round2(amount / Math.max(1, paymentDays.length));
  return paymentDays.map((paymentDay, index) => ({ date: dateInMonth(year, month, paymentDay), amount: index === paymentDays.length - 1 ? round2(amount - perPayment * (paymentDays.length - 1)) : perPayment, label: "Renda informada no perfil", source: "configured", confidence: "high", formulaVersion: FUTURE_INCOME_FORMULA_VERSION }));
}
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function inferredEvents(input: Input): FutureIncomeEvent[] {
  const todayIso = iso(input.today);
  const history = input.txs.filter((t) => t.status === "confirmed" && t.type === "income" && t.occurred_at.slice(0, 10) < todayIso && dayDistance(t.occurred_at.slice(0, 10), todayIso) <= 150);
  const byMonth = new Map<string, TransactionRow[]>();
  for (const row of history) byMonth.set(row.occurred_at.slice(0, 7), [...(byMonth.get(row.occurred_at.slice(0, 7)) ?? []), row]);
  const dominant = [...byMonth.values()].map((rows) => rows.sort((a, b) => Number(b.amount) - Number(a.amount))[0]).filter(Boolean);
  if (dominant.length < 3) return [];
  const amount = round2(median(dominant.map((t) => Number(t.amount || 0))));
  const day = Math.round(median(dominant.map((t) => Number(t.occurred_at.slice(8, 10)))));
  return amount > 0 ? [{ date: dateInMonth(input.today.getFullYear(), input.today.getMonth(), day), amount, label: "Renda estimada pelo histórico", source: "inferred", confidence: dominant.length >= 5 ? "medium" : "low", formulaVersion: FUTURE_INCOME_FORMULA_VERSION }] : [];
}
export function computeFutureIncomeProjection(input: Input): FutureIncomeProjection {
  const todayIso = iso(input.today), explicit = explicitIncomeEvents(input), configured = configuredEvents(input), selected = configured.length ? configured : inferredEvents(input);
  const confirmed = input.txs.filter((t) => t.status === "confirmed" && t.type === "income" && t.occurred_at.slice(0, 7) === todayIso.slice(0, 7)).map((t) => ({ date: t.occurred_at.slice(0, 10), amount: Number(t.amount || 0) }));
  const events = selected.filter((event) => event.date > todayIso && event.date <= input.periodEnd && ![...explicit, ...confirmed].some((known) => dayDistance(known.date, event.date) <= 3 && amountMatches(known.amount, event.amount)));
  return { events, total: round2(events.reduce((sum, event) => sum + event.amount, 0)), source: events[0]?.source ?? null, confidence: events[0]?.confidence ?? null, formulaVersion: FUTURE_INCOME_FORMULA_VERSION };
}