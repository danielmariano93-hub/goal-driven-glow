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
import { comparablePeriods, daysBetween, monthRange, shiftMonth } from "./periods.ts";

export type CompareInput = {
  txs: TransactionRow[];
  categoryNames: Map<string, string>;
  metric: "expense" | "income";
  period_a: { from: string; to: string };
  period_b: { from: string; to: string };
  group_by?: "category" | "none";
  /** Grounded reference scope from ConversationReferenceStore. */
  category_scope?: string[];
};

export type CompareResult = {
  metric: "expense" | "income";
  total_a: number;
  total_b: number;
  delta_abs: number;
  delta_pct: number | null; // null se total_a = 0
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
    // finance_truth.v1: nunca agrupar por category_id cru — o estorno pertence
    // economicamente à categoria da despesa que ele devolve.
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

export type CompareToMonthlyAverageResult = {
  metric: "expense" | "income";
  total_a: number;
  total_b: number;
  delta_abs: number;
  delta_pct: number | null;
  by_group: Array<{ name: string; total_a: number; total_b: number; delta_abs: number; delta_pct: number | null }>;
  comparable: boolean;
  baseline_statistic: "mean";
  target_statistic: "monthly_mean";
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
    const ta = A.byCat.get(name) ?? 0;
    const tb = B.byCat.get(name) ?? 0;
    const da = tb - ta;
    const dp = ta > 0 ? da / ta : (tb > 0 ? null : 0);
    return { name, total_a: round2(ta), total_b: round2(tb), delta_abs: round2(da), delta_pct: dp === null ? null : round4(dp) };
  }).sort((x, y) => Math.abs(y.delta_abs) - Math.abs(x.delta_abs));

  const delta_abs = B.total - A.total;
  const delta_pct = A.total > 0 ? delta_abs / A.total : null;
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
    total_a: round2(A.total),
    total_b: round2(B.total),
    delta_abs: round2(delta_abs),
    delta_pct: delta_pct === null ? null : round4(delta_pct),
    by_group,
    comparable: comparablePeriods(input.period_a, input.period_b),
    applied_reference_scope: scopeLabels.length
      ? { target: "category", entity_labels: scopeLabels }
      : null,
    provenance,
  };
}

function targetWindowMonths(period: { from: string; to: string }): number {
  const from = new Date(`${period.from}T12:00:00Z`);
  const to = new Date(`${period.to}T12:00:00Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) return 1;
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  // A single calendar month remains a single observation. Rolling windows such
  // as "últimos 3 meses" are normalized to their monthly mean before being
  // compared with a monthly baseline. This prevents total(3m) vs mean(1m).
  if (from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()) return 1;
  return Math.max(1, Math.round(days / 30.4375));
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

  const baselinePeriods = Array.from({ length: months }, (_, index) => {
    const offset = months - index;
    const shifted = shiftMonth(input.target_period.from, -offset);
    const range = monthRange(shifted);
    return { from: range.from, to: range.to };
  });
  const baseline = baselinePeriods.map((period) =>
    sumInPeriod(ledger, input.metric, period.from, period.to, input.categoryNames, attribution, scope)
  );
  const target = sumInPeriod(
    ledger, input.metric, input.target_period.from, input.target_period.to,
    input.categoryNames, attribution, scope,
  );

  const targetMonths = targetWindowMonths(input.target_period);
  const totalA = baseline.reduce((sum, item) => sum + item.total, 0) / months;
  const totalB = target.total / targetMonths;
  const names = new Set<string>(target.byCat.keys());
  for (const item of baseline) for (const name of item.byCat.keys()) names.add(name);

  const by_group = [...names].map((name) => {
    const baselineMean = baseline.reduce((sum, item) => sum + (item.byCat.get(name) ?? 0), 0) / months;
    const targetTotal = (target.byCat.get(name) ?? 0) / targetMonths;
    const delta = targetTotal - baselineMean;
    const pct = baselineMean > 0 ? delta / baselineMean : (targetTotal > 0 ? null : 0);
    return {
      name,
      total_a: round2(baselineMean),
      total_b: round2(targetTotal),
      delta_abs: round2(delta),
      delta_pct: pct == null ? null : round4(pct),
    };
  }).sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs));

  const delta = totalB - totalA;
  const totalRows = baseline.reduce((sum, item) => sum + item.rows, 0) + target.rows;
  const totalDays = baseline.reduce((sum, item) => sum + item.days, 0) + target.days;
  const provenance = makeProvenance({
    from: baselinePeriods[0].from,
    to: input.target_period.to,
    row_count: totalRows,
    formula_version: "compare.monthly_mean.v2",
    confidence: confidenceFromSample(totalRows, totalDays),
    notes: [
      "Baseline = média de " + months + " meses completos imediatamente anteriores ao período alvo.",
      "Alvo = média mensal do período alvo (" + targetMonths + " mês(es) equivalentes); nunca comparar total multi-mês com média mensal.",
    ],
  });

  return {
    metric: input.metric,
    total_a: round2(totalA),
    total_b: round2(totalB),
    delta_abs: round2(delta),
    delta_pct: totalA > 0 ? round4(delta / totalA) : null,
    by_group,
    comparable: true,
    baseline_statistic: "mean",
    target_statistic: "monthly_mean",
    target_window_months: targetMonths,
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
