// forecast_month_close — previsão de fechamento do mês com 3 modelos:
//  baseline.v1 : média corrida do mês projetada linearmente
//  observed.v1 : baseline + compromissos futuros conhecidos (recorrentes)
//  seasonal.v1 : observed com ajuste sazonal (>=6 meses de histórico)
//
// TODAS as regras contábeis passam por isRealMonthlyMovement — transferência,
// aplicação, resgate, pagamento de fatura NÃO contam.
import { isRealMonthlyMovement, type TransactionRow, type RecurringRow } from "../engine/facts.ts";
import { makeProvenance, type Provenance, type Confidence } from "./provenance.ts";
import { monthRange, dayOfMonth, shiftMonth, todaySP } from "./periods.ts";

export type ForecastInput = {
  txs: TransactionRow[];
  recurring?: RecurringRow[];
  today?: string; // YYYY-MM-DD SP
  model?: "auto" | "baseline" | "observed" | "seasonal";
};

export type ForecastResult = {
  month: string;              // YYYY-MM
  point: number;              // R$
  low: number | null;
  high: number | null;
  model_used: "baseline.v1" | "observed.v1" | "seasonal.v1";
  drivers: {
    mtd_expense: number;
    day_of_month: number;
    days_in_month: number;
    recurring_future: number;
    seasonal_adjust: number;
  };
  backtest_summary?: { wape: number; bias: number; sample_months: number } | null;
  provenance: Provenance;
};

export const FORMULA_VERSIONS = {
  baseline: "forecast.baseline.v1",
  observed: "forecast.observed.v1",
  seasonal: "forecast.seasonal.v1",
} as const;

function monthTotal(txs: TransactionRow[], from: string, to: string): { total: number; days: Set<string>; count: number } {
  let total = 0;
  const days = new Set<string>();
  let count = 0;
  for (const t of txs) {
    if (t.type !== "expense") continue;
    if (!isRealMonthlyMovement(t)) continue;
    const d = t.occurred_at.slice(0, 10);
    if (d < from || d > to) continue;
    total += Number(t.amount || 0);
    days.add(d);
    count += 1;
  }
  return { total, days, count };
}

function pickConfidence(daysObserved: number, daysInMonth: number, wape: number | null): Confidence {
  if (daysObserved < 3) return "insufficient_data";
  if (daysObserved >= 15 && (wape === null || wape <= 0.15)) return "high";
  if (daysObserved >= 7 && (wape === null || wape <= 0.25)) return "medium";
  return "low";
}

export function computeForecast(input: ForecastInput): ForecastResult {
  const today = input.today ?? todaySP();
  const { from, to, daysInMonth } = monthRange(today);
  const dom = Math.max(1, dayOfMonth(today));

  const cur = monthTotal(input.txs, from, today);
  const mtdExpense = cur.total;
  const daysObserved = cur.days.size;

  // baseline: linear
  const dailyAvg = dom > 0 ? mtdExpense / dom : 0;
  const baselinePoint = dailyAvg * daysInMonth;

  // recorrentes futuros (aditivo simples: nesta versão contamos gasto recorrente
  // ainda por acontecer neste mês; refino via recurring_occurrences pode vir depois)
  const recurringFuture = estimateRecurringFuture(input.recurring ?? [], today, to);

  const observedPoint = mtdExpense + Math.max(0, baselinePoint - mtdExpense) * 0.7 + recurringFuture;

  // sazonal: precisa de >=6 meses passados
  const monthlyHistory = buildMonthlyHistory(input.txs, today, 12);
  const hasSeasonal = monthlyHistory.length >= 6;
  const seasonalAdjust = hasSeasonal ? seasonalFactor(monthlyHistory, today) : 0;
  const seasonalPoint = observedPoint + seasonalAdjust;

  // Backtest walk-forward simplificado sobre os últimos meses
  const backtest = backtestObserved(input.txs, today, 6);

  // Seleção do modelo
  const model = input.model ?? "auto";
  let chosen: "baseline" | "observed" | "seasonal";
  if (model === "auto") {
    chosen = hasSeasonal ? "seasonal" : (input.recurring && input.recurring.length ? "observed" : "baseline");
  } else {
    chosen = model === "seasonal" && !hasSeasonal ? "observed" : model;
  }

  const point = chosen === "seasonal" ? seasonalPoint : chosen === "observed" ? observedPoint : baselinePoint;

  // intervalo por bootstrap simples: variância diária dos últimos 90 dias
  const band = confidenceBand(input.txs, today, point, daysInMonth - dom);

  const confidence = pickConfidence(daysObserved, daysInMonth, backtest?.wape ?? null);
  const version = FORMULA_VERSIONS[chosen];

  return {
    month: from.slice(0, 7),
    point: round2(point),
    low: band ? round2(band.low) : null,
    high: band ? round2(band.high) : null,
    model_used: version as ForecastResult["model_used"],
    drivers: {
      mtd_expense: round2(mtdExpense),
      day_of_month: dom,
      days_in_month: daysInMonth,
      recurring_future: round2(recurringFuture),
      seasonal_adjust: round2(seasonalAdjust),
    },
    backtest_summary: backtest,
    provenance: makeProvenance({
      from, to,
      row_count: cur.count,
      formula_version: version,
      confidence,
      maturity: { days_observed: daysObserved, days_in_month: daysInMonth },
      notes: confidence === "insufficient_data"
        ? ["Ainda estou aprendendo seu ritmo — registro mais alguns dias antes de dar previsão firme."]
        : undefined,
    }),
  };
}

function estimateRecurringFuture(rec: RecurringRow[], today: string, monthEnd: string): number {
  let sum = 0;
  const dTod = new Date(`${today}T12:00:00Z`).getTime();
  const dEnd = new Date(`${monthEnd}T12:00:00Z`).getTime();
  for (const r of rec) {
    if (!r.active || r.type !== "expense") continue;
    // conta uma ocorrência simples se next_due_date cair no restante do mês
    if (!r.next_due_date) continue;
    const d = new Date(`${r.next_due_date}T12:00:00Z`).getTime();
    if (d > dTod && d <= dEnd) sum += Number(r.amount || 0);
  }
  return sum;
}

function buildMonthlyHistory(txs: TransactionRow[], today: string, months: number): Array<{ month: string; total: number }> {
  const out: Array<{ month: string; total: number }> = [];
  for (let i = 1; i <= months; i++) {
    const anchor = shiftMonth(today, -i);
    const { from, to } = monthRange(anchor);
    const m = monthTotal(txs, from, to);
    // só inclui meses "fechados" (fim < hoje)
    if (to < today) out.push({ month: from.slice(0, 7), total: m.total });
  }
  return out;
}

function seasonalFactor(history: Array<{ month: string; total: number }>, today: string): number {
  const meanAll = history.reduce((s, h) => s + h.total, 0) / history.length;
  const targetMonth = today.slice(5, 7);
  const sameMonthAvg = (() => {
    const xs = history.filter(h => h.month.slice(5, 7) === targetMonth).map(h => h.total);
    if (!xs.length) return meanAll;
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  })();
  return sameMonthAvg - meanAll;
}

function backtestObserved(txs: TransactionRow[], today: string, months: number): { wape: number; bias: number; sample_months: number } | null {
  const points: Array<{ pred: number; real: number }> = [];
  for (let i = 1; i <= months; i++) {
    const anchor = shiftMonth(today, -i);
    const { from, to, daysInMonth } = monthRange(anchor);
    if (to >= today) continue;
    // pretende ter previsto no dia 15
    const cutDay = 15;
    const cutDate = `${from.slice(0, 8)}${String(cutDay).padStart(2, "0")}`;
    const mtd = monthTotal(txs, from, cutDate);
    const real = monthTotal(txs, from, to);
    if (real.count < 5) continue;
    const pred = mtd.total / cutDay * daysInMonth;
    points.push({ pred, real: real.total });
  }
  if (points.length < 2) return null;
  const totalReal = points.reduce((s, p) => s + Math.abs(p.real), 0);
  const totalAbsErr = points.reduce((s, p) => s + Math.abs(p.pred - p.real), 0);
  const wape = totalReal > 0 ? totalAbsErr / totalReal : 0;
  const bias = points.reduce((s, p) => s + (p.pred - p.real), 0) / points.length;
  return { wape: round4(wape), bias: round2(bias), sample_months: points.length };
}

function confidenceBand(txs: TransactionRow[], today: string, point: number, daysRemaining: number): { low: number; high: number } | null {
  // stdev diária dos últimos 90 dias
  const past = new Date(`${today}T12:00:00Z`);
  past.setUTCDate(past.getUTCDate() - 90);
  const from = past.toISOString().slice(0, 10);
  const daily = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== "expense") continue;
    if (!isRealMonthlyMovement(t)) continue;
    const d = t.occurred_at.slice(0, 10);
    if (d < from || d > today) continue;
    daily.set(d, (daily.get(d) ?? 0) + Number(t.amount || 0));
  }
  const vals = [...daily.values()];
  if (vals.length < 30) return null;
  const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
  const variance = vals.reduce((s, x) => s + (x - mean) ** 2, 0) / vals.length;
  const std = Math.sqrt(variance);
  const uncertainty = std * Math.sqrt(Math.max(1, daysRemaining));
  return { low: Math.max(0, point - 1.96 * uncertainty), high: point + 1.96 * uncertainty };
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round4(n: number) { return Math.round((n + Number.EPSILON) * 10000) / 10000; }
