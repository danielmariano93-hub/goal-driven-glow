// compare_periods — delta de gasto/receita entre dois períodos, com quebra
// por grupo. Só considera movimentos "reais" (isRealMonthlyMovement) para
// evitar contar transferências/aplicações como gasto.
import { behavioralMetricAmount, type TransactionRow } from "../engine/facts.ts";
import { makeProvenance, confidenceFromSample, type Provenance } from "./provenance.ts";
import { comparablePeriods, daysBetween } from "./periods.ts";

export type CompareInput = {
  txs: TransactionRow[];
  categoryNames: Map<string, string>;
  metric: "expense" | "income";
  period_a: { from: string; to: string };
  period_b: { from: string; to: string };
  group_by?: "category" | "none";
};

export type CompareResult = {
  metric: "expense" | "income";
  total_a: number;
  total_b: number;
  delta_abs: number;
  delta_pct: number | null; // null se total_a = 0
  by_group: Array<{ name: string; total_a: number; total_b: number; delta_abs: number; delta_pct: number | null }>;
  comparable: boolean;
  provenance: Provenance;
};

export const FORMULA_VERSION = "compare.v1";

function sumInPeriod(txs: TransactionRow[], metric: "expense" | "income", from: string, to: string, names: Map<string, string>) {
  let total = 0;
  const byCat = new Map<string, number>();
  let rows = 0;
  const daySet = new Set<string>();
  for (const t of txs) {
    const d = t.occurred_at.slice(0, 10);
    if (d < from || d > to) continue;
    const amt = behavioralMetricAmount(t, metric);
    if (amt === 0) continue;
    total += amt;
    rows += 1;
    daySet.add(d);
    const cat = t.category_id ? (names.get(t.category_id) ?? "Sem categoria") : "Sem categoria";
    byCat.set(cat, (byCat.get(cat) ?? 0) + amt);
  }
  return { total, byCat, rows, days: daySet.size };
}

export function computeCompare(input: CompareInput): CompareResult {
  const A = sumInPeriod(input.txs, input.metric, input.period_a.from, input.period_a.to, input.categoryNames);
  const B = sumInPeriod(input.txs, input.metric, input.period_b.from, input.period_b.to, input.categoryNames);

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
    provenance,
  };
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round4(n: number) { return Math.round((n + Number.EPSILON) * 10000) / 10000; }
