// DailySeriesHandler (`nino_daily_series.v1`)
// Deterministic day-by-day spending read ("gráfico diário de setembro de
// Transporte no Uber"). Same scope truth as the monthly series (category +
// merchant, competence, refunds); only the bucket is the calendar day. The LLM
// never calculates the values; it only receives these audited facts.
// deno-lint-ignore-file no-explicit-any
import { round2 } from "../../../finance-core/facts.ts";
import type { FinancialQueryV3 } from "../FinancialIRv3.ts";
import type { ExecutedIR } from "../SemanticPreservation.ts";
import { collectScopedSpend, type ScopedSpendArgs } from "./MonthlySeriesHandler.ts";

export const DAILY_SERIES_FORMULA_VERSION = "daily_spending_series.v1";
/** Mais que isso vira gráfico ilegível: a leitura diária é de até ~3 meses. */
export const MAX_DAILY_SERIES_DAYS = 93;

export type DailySeriesPoint = { date: string; total: number; transaction_count: number };

export type DailySpendingSeriesResult = {
  version: "nino_daily_series.v1";
  formula_version: typeof DAILY_SERIES_FORMULA_VERSION;
  days: DailySeriesPoint[];
  total: number;
  transaction_count: number;
  active_days: number;
  average_per_active_day: number;
  peak: DailySeriesPoint | null;
  window: { from: string; to: string; n: number };
  scope: { category: string | null; merchant: string | null };
};

function daysInWindow(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end && out.length <= 400) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Pure bucketing — exported for tests. */
export function buildDailySeries(
  entries: Array<{ date: string; amount: number }>,
  args: { from: string; to: string; category_label?: string | null; merchant?: string | null },
): DailySpendingSeriesResult {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.date < args.from || entry.date > args.to) continue;
    totals.set(entry.date, round2((totals.get(entry.date) ?? 0) + entry.amount));
    counts.set(entry.date, (counts.get(entry.date) ?? 0) + 1);
  }
  const days = daysInWindow(args.from, args.to).map((date) => ({
    date,
    total: round2(totals.get(date) ?? 0),
    transaction_count: counts.get(date) ?? 0,
  }));
  const total = round2(days.reduce((sum, day) => sum + day.total, 0));
  const active = days.filter((day) => day.transaction_count > 0);
  const peak = active.reduce<DailySeriesPoint | null>((best, day) => !best || day.total > best.total ? day : best, null);
  return {
    version: "nino_daily_series.v1",
    formula_version: DAILY_SERIES_FORMULA_VERSION,
    days,
    total,
    transaction_count: days.reduce((sum, day) => sum + day.transaction_count, 0),
    active_days: active.length,
    average_per_active_day: active.length ? round2(total / active.length) : 0,
    peak,
    window: { from: args.from, to: args.to, n: days.length },
    scope: {
      category: args.category_label?.trim() || null,
      merchant: String(args.merchant ?? "").trim() || null,
    },
  };
}

export async function loadDailySpendingSeries(sb: any, args: ScopedSpendArgs): Promise<DailySpendingSeriesResult> {
  return buildDailySeries(await collectScopedSpend(sb, args), args);
}

const brl = (value: number) => value.toLocaleString("pt-BR", {
  style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

export function dailyScopeLabel(result: DailySpendingSeriesResult): string {
  const { category, merchant } = result.scope;
  if (category && merchant) return `${category} no ${merchant}`;
  return category ?? merchant ?? "todos os gastos";
}

/** Texto diagramado: total, dias com gasto, pico e os dias que mais pesaram. */
export function dailySpendingSeriesText(result: DailySpendingSeriesResult): string {
  const scope = dailyScopeLabel(result);
  const period = `${ddmm(result.window.from)} a ${ddmm(result.window.to)}`;
  if (!result.active_days) return `Não encontrei gastos de *${scope}* entre ${period}.`;
  const top = [...result.days].filter((day) => day.transaction_count > 0)
    .sort((a, b) => b.total - a.total).slice(0, 5)
    .sort((a, b) => a.date.localeCompare(b.date));
  const count = (n: number) => `${n} ${n === 1 ? "lançamento" : "lançamentos"}`;
  return [
    `📊 *${scope}, dia a dia* (${period})`,
    "",
    `*Total:* ${brl(result.total)} em ${count(result.transaction_count)}`,
    `*Dias com gasto:* ${result.active_days} de ${result.window.n}`,
    `*Média nos dias com gasto:* ${brl(result.average_per_active_day)}`,
    result.peak ? `*Maior dia:* ${ddmm(result.peak.date)}, com ${brl(result.peak.total)}` : "",
    "",
    "*Dias que mais pesaram*",
    ...top.map((day) => `• ${ddmm(day.date)}: ${brl(day.total)} (${count(day.transaction_count)})`),
  ].filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n").trim();
}

export function dailySeriesExecutedIR(query: FinancialQueryV3, result: DailySpendingSeriesResult): ExecutedIR {
  return {
    metric: "expense_amount",
    filters: query.filters ?? [],
    time: {
      aspect: query.time.aspect,
      from: result.window.from,
      to: result.window.to,
      n: query.time.n,
      exclude_partial: query.time.exclude_partial,
    },
    grain: "day",
    reduce: query.reduce,
    group_by: query.group_by ?? [],
    partial: false,
  };
}
