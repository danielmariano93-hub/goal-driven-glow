// Média diária ACUMULADA — série determinística que responde a
// "meu gasto médio dia a dia", "estou reduzindo?", "andando de lado?", "tendência".
//
// Diferente de spending_timeseries_daily (gasto do dia + média móvel 7d),
// aqui calculamos: para cada dia d do período, média = consumo_acumulado(1..d) / d.
// Só consumo real, filtrado por isRealMonthlyMovement — mesma definição da Home
// (exclui aplicações, aportes, transferências, pagamento de fatura, etc.).
import { behavioralMetricAmount, type TransactionRow } from "../engine/facts.ts";
import { makeProvenance, confidenceFromSample, type Provenance } from "./provenance.ts";
import { daysBetween, todaySP, monthRange } from "./periods.ts";

export const FORMULA_VERSION = "daily_average.cumulative.v1";

export type TrendKind = "falling" | "rising" | "flat";

export type CumulativeDailyAveragePoint = {
  date: string;                          // YYYY-MM-DD
  daily_consumption: number;
  cumulative_consumption: number;
  elapsed_days: number;
  cumulative_daily_average: number;
  daily_average_change: number;          // vs. dia anterior
  daily_average_change_pct: number;      // fração (0.05 = +5%)
};

export type CumulativeDailyAverageResult = {
  metric: "expense";
  from: string;
  to: string;
  points: CumulativeDailyAveragePoint[];
  labels: string[];                      // YYYY-MM-DD
  daily: number[];
  cumulative_average: number[];
  final_average: number;
  first_average: number;
  trend: TrendKind;
  trend_change_pct: number;              // do primeiro dia ao último
  slope_per_day: number;                 // R$/dia (regressão linear simples)
  provenance: Provenance;
};

function addDays(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function linearSlope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (y[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  return den === 0 ? 0 : num / den;
}

export function computeCumulativeDailyAverage(input: {
  txs: TransactionRow[];
  from?: string;
  to?: string;
}): CumulativeDailyAverageResult {
  const today = todaySP();
  const cur = monthRange(today);
  const from = input.from ?? cur.from;
  // Não projetar para o futuro: teto em today quando o pedido for o mês corrente.
  const requestedTo = input.to ?? today;
  const to = requestedTo > today ? today : requestedTo;

  const nDays = Math.max(1, daysBetween(from, to));
  const labels: string[] = [];
  for (let i = 0; i < nDays; i++) labels.push(addDays(from, i));

  const byDay = new Map<string, number>();
  let rows = 0;
  for (const t of input.txs) {
    const d = String(t.occurred_at ?? "").slice(0, 10);
    if (!d || d < from || d > to) continue;
    const signed = behavioralMetricAmount(t, "expense");
    if (signed === 0) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + signed);
    rows += 1;
  }

  const daily: number[] = [];
  const cumulative_average: number[] = [];
  const points: CumulativeDailyAveragePoint[] = [];
  let running = 0;
  let prevAvg = 0;
  for (let i = 0; i < labels.length; i++) {
    const d = labels[i];
    const dc = round2(Math.max(0, byDay.get(d) ?? 0));
    daily.push(dc);
    running += dc;
    const elapsed = i + 1;
    const avg = round2(running / elapsed);
    cumulative_average.push(avg);
    const change = round2(avg - prevAvg);
    const changePct = prevAvg > 0 ? round2((avg - prevAvg) / prevAvg) : 0;
    points.push({
      date: d,
      daily_consumption: dc,
      cumulative_consumption: round2(running),
      elapsed_days: elapsed,
      cumulative_daily_average: avg,
      daily_average_change: change,
      daily_average_change_pct: changePct,
    });
    prevAvg = avg;
  }

  const first_average = cumulative_average[0] ?? 0;
  const final_average = cumulative_average[cumulative_average.length - 1] ?? 0;
  const trend_change_pct = first_average > 0
    ? round2((final_average - first_average) / first_average)
    : 0;
  const slope = round2(linearSlope(cumulative_average));

  // heurística de tendência: precisa de >=3 pontos e variação >3% para deixar de ser "flat"
  let trend: TrendKind = "flat";
  if (cumulative_average.length >= 3) {
    if (trend_change_pct <= -0.03) trend = "falling";
    else if (trend_change_pct >= 0.03) trend = "rising";
  }

  const daysWithData = daily.filter((v) => v > 0).length;
  const provenance = makeProvenance({
    from, to, row_count: rows,
    formula_version: FORMULA_VERSION,
    confidence: confidenceFromSample(rows, daysWithData || nDays),
  });

  return {
    metric: "expense",
    from, to,
    points,
    labels,
    daily,
    cumulative_average,
    final_average,
    first_average,
    trend,
    trend_change_pct,
    slope_per_day: slope,
    provenance,
  };
}
