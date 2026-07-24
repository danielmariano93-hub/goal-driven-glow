// spending_timeseries_daily — série diária real de gastos com média móvel
// de 7 dias, para gráfico de linha. Só considera movimentos reais
// (isRealMonthlyMovement) para não contar transferência/investimento.
import { behavioralMetricAmount, type TransactionRow } from "../engine/facts.ts";
import { makeProvenance, confidenceFromSample, type Provenance } from "./provenance.ts";
import { daysBetween, todaySP, monthRange } from "./periods.ts";

export const FORMULA_VERSION = "timeseries.daily.v1";

export type TimeseriesResult = {
  metric: "expense" | "income";
  from: string;
  to: string;
  labels: string[];              // "YYYY-MM-DD"
  daily: number[];               // valor por dia
  rolling7: number[];             // média móvel de 7 dias
  total: number;
  daily_avg: number;
  provenance: Provenance;
};

function addDays(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function computeDailySpend(input: {
  txs: TransactionRow[];
  metric?: "expense" | "income";
  from?: string;
  to?: string;
}): TimeseriesResult {
  const metric = input.metric ?? "expense";
  const today = todaySP();
  const cur = monthRange(today);
  const from = input.from ?? cur.from;
  const to = input.to ?? today;

  const nDays = Math.max(1, daysBetween(from, to));
  const labels: string[] = [];
  for (let i = 0; i < nDays; i++) labels.push(addDays(from, i));

  const byDay = new Map<string, number>();
  let rows = 0;
  for (const t of input.txs) {
    const d = t.occurred_at.slice(0, 10);
    if (d < from || d > to) continue;
    const signed = behavioralMetricAmount(t, metric);
    if (signed === 0) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + signed);
    rows += 1;
  }

  // Preserva sinal: dias com estorno líquido negativo aparecem como valor
  // negativo (contabilmente honesto). O clamp visual, se necessário, fica
  // a cargo do renderer.
  const daily = labels.map((d) => round2(byDay.get(d) ?? 0));
  const rolling7 = daily.map((_, i) => {
    const start = Math.max(0, i - 6);
    const slice = daily.slice(start, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    return round2(avg);
  });

  const total = round2(daily.reduce((a, b) => a + b, 0));
  const daysWithData = daily.filter((v) => v !== 0).length;
  const daily_avg = round2(daysWithData > 0 ? total / daysWithData : 0);

  const provenance = makeProvenance({
    from, to, row_count: rows,
    formula_version: FORMULA_VERSION,
    confidence: confidenceFromSample(rows, daysWithData || nDays),
  });

  return { metric, from, to, labels, daily, rolling7, total, daily_avg, provenance };
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
