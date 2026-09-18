// compare_periods — delta de gasto/receita entre dois períodos, com quebra
// por grupo. Só considera movimentos "reais" (isRealMonthlyMovement) para
// evitar contar transferências/aplicações como gasto.
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  type TransactionRow,
} from "../engine/facts.ts";
import { makeProvenance, confidenceFromSample, type Provenance } from "./provenance.ts";
import { comparablePeriods, daysBetween } from "./periods.ts";

export type CompareInput = {
  txs: TransactionRow[];
  categoryNames: Map<string, string>;
  metric: "expense" | "income";
  period_a: { from: string; to: string };
  period_b: { from: string; to: string };
  group_by?: "category" | "none";
  category_scope?: string[];
};

export type CompareResult = {
  metric: "expense" | "income";
  total_a: number;
  total_b: number;
  delta_abs: number;
  delta_pct: number | null;
  by_group: Array<{ name: string; total_a: number; total_b: number; delta_abs: number; delta_pct: number | null }>;
  comparable: boolean;
  applied_reference_scope: { target: "category"; entity_labels: string[] } | null;
  provenance: Provenance;
};

export const FORMULA_VERSION = "compare.v1";

function sumInPeriod(
  txs: TransactionRow[],
  metric: "expense" | "income",
  from: string,
  to: string,
  names: Map<string, string>,
  attribution: Map<string, string | null>,
  categoryScope?: Set<string> | null,
) {
  let total = 0;
  const byCat = new Map<string, number>();
  let rows = 0;
  const daySet = new Set<string>();
  for (const t of txs) {
    const d = t.occurred_at.slice(0, 10);
    if (d < from || d > to) continue;
    const amt = behavioralMetricAmount(t, metric);
    if (amt === 0) continue;
    const effectiveId = effectiveCategoryId(t, attribution);
    const cat = effectiveId ? (names.get(effectiveId) ?? "Sem categoria") : "Sem categoria";
    const normalizedCat = cat.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (categoryScope && !categoryScope.has(normalizedCat)) continue;
    total += amt;
    rows += 1;
    daySet.add(d);
    byCat.set(cat, (byCat.get(cat) ?? 0) + amt);
  }
  return { total, byCat, rows, days: daySet.size };
}

export type CompareToMonthlyAverageInput = {
  txs: TransactionRow[];
  categoryNames: Map<string, string>;
  metric: "expense" | "income";
  target_period: { from: string; to: string };
  months: number;
  group_by?: "category" | "none";
  category_scope?: string[];
};

export type MonthlyAverageAlignment =
  | "complete_calendar_months"
  | "aligned_month_to_date"
  | "preceding_rolling_window";

export type CompareToMonthlyAverageResult = {
  metric: "expense" | "income";
  total_a: number;
  total_b: number;
  delta_abs: number;
  delta_pct: number | null;
  by_group: Array<{ name: string; total_a: number; total_b: number; delta_abs: number; delta_pct: number | null }>;
  comparable: boolean;
  baseline_statistic: "mean";
  target_statistic: "monthly_mean" | "aligned_period_amount";
  comparison_alignment: MonthlyAverageAlignment;
  target_window_months: number;
  baseline_window_months: number;
  baseline_periods: Array<{ from: string; to: string }>;
  target_period: { from: string; to: string };
  applied_reference_scope: { target: "category"; entity_labels: string[] } | null;
  provenance: Provenance;
};

export function computeCompare(input: CompareInput): CompareResult {
  const ledger = input.txs.filter((t) => String(t.status ?? "confirmed") !== "superseded");
  const attribution = buildRefundAttribution(ledger);
  const scopeLabels = [...new Set((input.category_scope ?? []).map((value) => String(value).trim()).filter(Boolean))];
  const scope = scopeLabels.length
    ? new Set(scopeLabels.map((value) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")))
    : null;
  const A = sumInPeriod(ledger, input.metric, input.period_a.from, input.period_a.to, input.categoryNames, attribution, scope);
  const B = sumInPeriod(ledger, input.metric, input.period_b.from, input.period_b.to, input.categoryNames, attribution, scope);

  const cats = new Set<string>([...A.byCat.keys(), ...B.byCat.keys()]);
  const by_group = [...cats].map(name => {
    const ta = round2(A.byCat.get(name) ?? 0);
    const tb = round2(B.byCat.get(name) ?? 0);
    const da = round2(tb - ta);
    const dp = ta > 0 ? da / ta : (tb > 0 ? null : 0);
    return { name, total_a: ta, total_b: tb, delta_abs: da, delta_pct: dp === null ? null : round4(dp) };
  }).sort((x, y) => Math.abs(y.delta_abs) - Math.abs(x.delta_abs));

  const totalA = round2(A.total);
  const totalB = round2(B.total);
  const delta_abs = round2(totalB - totalA);
  const delta_pct = totalA > 0 ? delta_abs / totalA : null;
  const totalRows = A.rows + B.rows;
  const totalDays = A.days + B.days;

  const provenance = makeProvenance({
    from: input.period_a.from,
    to: input.period_b.to,
    row_count: totalRows,
    formula_version: FORMULA_VERSION,
    confidence: confidenceFromSample(totalRows, totalDays),
    notes: comparablePeriods(input.period_a, input.period_b)
      ? undefined
      : [`Períodos com tamanhos diferentes (${daysBetween(input.period_a.from, input.period_a.to)}d vs ${daysBetween(input.period_b.from, input.period_b.to)}d).`],
  });

  return {
    metric: input.metric,
    total_a: totalA,
    total_b: totalB,
    delta_abs,
    delta_pct: delta_pct === null ? null : round4(delta_pct),
    by_group,
    comparable: comparablePeriods(input.period_a, input.period_b),
    applied_reference_scope: scopeLabels.length
      ? { target: "category", entity_labels: scopeLabels }
      : null,
    provenance,
  };
}

function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftMonthsClamped(value: string, months: number): string {
  const parsed = parseYmd(value);
  if (!parsed) return value;
  const index = parsed.year * 12 + (parsed.month - 1) + months;
  const year = Math.floor(index / 12);
  const monthZero = ((index % 12) + 12) % 12;
  const month = monthZero + 1;
  return ymd(year, month, Math.min(parsed.day, lastDayOfMonth(year, month)));
}

function shiftDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isSameMonth(period: { from: string; to: string }): boolean {
  return period.from.slice(0, 7) === period.to.slice(0, 7);
}

function isFullCalendarMonth(period: { from: string; to: string }): boolean {
  const from = parseYmd(period.from);
  const to = parseYmd(period.to);
  return !!from && !!to
    && from.year === to.year && from.month === to.month
    && from.day === 1 && to.day === lastDayOfMonth(to.year, to.month);
}

function isPartialMonthToDate(period: { from: string; to: string }): boolean {
  const from = parseYmd(period.from);
  const to = parseYmd(period.to);
  return !!from && !!to
    && from.year === to.year && from.month === to.month
    && from.day === 1 && to.day < lastDayOfMonth(to.year, to.month);
}

function exactCalendarMonthSpan(period: { from: string; to: string }): number | null {
  if (isSameMonth(period)) return 1;
  for (let months = 1; months <= 24; months++) {
    if (shiftMonthsClamped(period.from, months) === period.to) return months;
  }
  return null;
}

function targetWindowMonths(period: { from: string; to: string }): { months: number; exact: boolean } {
  const exact = exactCalendarMonthSpan(period);
  if (exact) return { months: exact, exact: true };
  const from = new Date(`${period.from}T12:00:00Z`);
  const to = new Date(`${period.to}T12:00:00Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) return { months: 1, exact: false };
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return { months: Math.max(1, Math.round(days / 30.4375)), exact: false };
}

function baselinePeriodsForTarget(
  target: { from: string; to: string },
  months: number,
): { periods: Array<{ from: string; to: string }>; alignment: MonthlyAverageAlignment } {
  if (isPartialMonthToDate(target)) {
    const targetTo = parseYmd(target.to)!;
    const periods = Array.from({ length: months }, (_, index) => {
      const offset = months - index;
      const start = shiftMonthsClamped(target.from, -offset);
      const parsed = parseYmd(start)!;
      const endDay = Math.min(targetTo.day, lastDayOfMonth(parsed.year, parsed.month));
      return { from: ymd(parsed.year, parsed.month, 1), to: ymd(parsed.year, parsed.month, endDay) };
    });
    return { periods, alignment: "aligned_month_to_date" };
  }

  const anchor = shiftMonthsClamped(target.from, -months);
  const periods = Array.from({ length: months }, (_, index) => {
    const from = shiftMonthsClamped(anchor, index);
    const next = shiftMonthsClamped(anchor, index + 1);
    return { from, to: shiftDays(next, -1) };
  });
  return {
    periods,
    alignment: isFullCalendarMonth(target) ? "complete_calendar_months" : "preceding_rolling_window",
  };
}

export function computeCompareToMonthlyAverage(
  input: CompareToMonthlyAverageInput,
): CompareToMonthlyAverageResult {
  const months = Math.max(2, Math.min(24, Math.trunc(input.months)));
  const ledger = input.txs.filter((t) => String(t.status ?? "confirmed") !== "superseded");
  const attribution = buildRefundAttribution(ledger);
  const scopeLabels = [...new Set((input.category_scope ?? []).map((value) => String(value).trim()).filter(Boolean))];
  const scope = scopeLabels.length
    ? new Set(scopeLabels.map((value) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")))
    : null;

  const { periods: baselinePeriods, alignment } = baselinePeriodsForTarget(input.target_period, months);
  const baseline = baselinePeriods.map((period) =>
    sumInPeriod(ledger, input.metric, period.from, period.to, input.categoryNames, attribution, scope)
  );
  const target = sumInPeriod(
    ledger, input.metric, input.target_period.from, input.target_period.to,
    input.categoryNames, attribution, scope,
  );

  const targetWindow = targetWindowMonths(input.target_period);
  const targetDivisor = alignment === "aligned_month_to_date" ? 1 : targetWindow.months;
  const totalARaw = baseline.reduce((sum, item) => sum + item.total, 0) / months;
  const totalBRaw = target.total / targetDivisor;
  const names = new Set<string>(target.byCat.keys());
  for (const item of baseline) for (const name of item.byCat.keys()) names.add(name);

  const by_group = [...names].map((name) => {
    const baselineMeanRaw = baseline.reduce((sum, item) => sum + (item.byCat.get(name) ?? 0), 0) / months;
    const targetValueRaw = (target.byCat.get(name) ?? 0) / targetDivisor;
    const baselineMean = round2(baselineMeanRaw);
    const targetValue = round2(targetValueRaw);
    const delta = round2(targetValue - baselineMean);
    const pct = baselineMean > 0 ? delta / baselineMean : (targetValue > 0 ? null : 0);
    return {
      name,
      total_a: baselineMean,
      total_b: targetValue,
      delta_abs: delta,
      delta_pct: pct == null ? null : round4(pct),
    };
  }).sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs));

  const totalA = round2(totalARaw);
  const totalB = round2(totalBRaw);
  const delta = round2(totalB - totalA);
  const totalRows = baseline.reduce((sum, item) => sum + item.rows, 0) + target.rows;
  const totalDays = baseline.reduce((sum, item) => sum + item.days, 0) + target.days;
  const comparable = alignment === "aligned_month_to_date" || targetWindow.exact;
  const targetStatistic = alignment === "aligned_month_to_date" ? "aligned_period_amount" as const : "monthly_mean" as const;
  const notes = alignment === "aligned_month_to_date"
    ? [
      `Baseline = média dos mesmos dias do mês nos ${months} meses anteriores.`,
      "Alvo = valor do mês atual até o mesmo dia; evita comparar mês parcial com mês completo.",
    ]
    : alignment === "preceding_rolling_window"
      ? [
        `Baseline = média mensal da janela imediatamente anterior, segmentada em ${months} mês(es) comparáveis.`,
        `Alvo = média mensal do período alvo (${targetWindow.months} mês(es) equivalentes).`,
      ]
      : [
        `Baseline = média dos ${months} meses completos imediatamente anteriores ao período alvo.`,
        "Alvo = valor mensal do mês alvo; as duas medidas estão na mesma granularidade mensal.",
      ];
  if (!comparable) notes.push("A duração do período alvo não fecha em meses de calendário exatos; a equivalência mensal foi estimada.");

  const provenance = makeProvenance({
    from: baselinePeriods[0].from,
    to: input.target_period.to,
    row_count: totalRows,
    formula_version: "compare.monthly_mean.v3",
    confidence: confidenceFromSample(totalRows, totalDays),
    notes,
  });

  return {
    metric: input.metric,
    total_a: totalA,
    total_b: totalB,
    delta_abs: delta,
    delta_pct: totalA > 0 ? round4(delta / totalA) : null,
    by_group,
    comparable,
    baseline_statistic: "mean",
    target_statistic: targetStatistic,
    comparison_alignment: alignment,
    target_window_months: targetWindow.months,
    baseline_window_months: months,
    baseline_periods: baselinePeriods,
    target_period: { ...input.target_period },
    applied_reference_scope: scopeLabels.length
      ? { target: "category", entity_labels: scopeLabels }
      : null,
    provenance,
  };
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round4(n: number) { return Math.round((n + Number.EPSILON) * 10000) / 10000; }
