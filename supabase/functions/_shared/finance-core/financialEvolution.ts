// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Motor de Estabilidade e Evolução Financeira (`financial_evolution.v1`).
// Responde "estou melhorando?" com fatos longitudinais: 30/90/180 dias, taxa de
// poupança, volatilidade do gasto, dependência de crédito e tendência.
import {
  behavioralMetricAmount,
  round2,
  type TransactionRow,
} from "./facts.ts";
import {
  confidenceFromSample,
  makeEnvelope,
  makeEvidence,
  medianOf,
  safePct,
  shiftDays,
  stdDevOf,
  type EngineEnvelope,
  type EnginePeriod,
} from "./engineEnvelope.ts";

export const FINANCIAL_EVOLUTION_VERSION = "financial_evolution.v1";

export interface EvolutionWindow {
  key: "30d" | "90d" | "180d";
  label: string;
  from: string;
  to: string;
  income: number;
  expense: number;
  net: number;
  /** Média mensal de gasto na janela. */
  expense_monthly_avg: number;
  /** Taxa de poupança = (renda - gasto) / renda. */
  savings_rate: number | null;
  transactions: number;
}

export interface MonthPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface FinancialEvolutionFacts {
  /** Tendência do gasto mensal: comparação 30d vs média dos 90d anteriores. */
  expense_trend_pct: number | null;
  trend: "melhorando" | "estavel" | "piorando";
  savings_rate_30d: number | null;
  savings_rate_180d: number | null;
  /** Volatilidade = desvio padrão do gasto mensal / mediana (coef. de variação). */
  expense_volatility: number | null;
  stability: "alta" | "media" | "baixa";
  months_positive: number;
  months_negative: number;
  best_month: MonthPoint | null;
  worst_month: MonthPoint | null;
}

export interface FinancialEvolutionInput {
  txs: TransactionRow[];
  /** Data de referência (hoje). */
  today: string;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function windowOf(today: string, days: number): EnginePeriod {
  return { from: shiftDays(today, -(days - 1)), to: today };
}

function aggregate(txs: TransactionRow[], period: EnginePeriod): { income: number; expense: number; count: number } {
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const t of txs) {
    const d = t.occurred_at.slice(0, 10);
    if (d < period.from || d > period.to) continue;
    const inc = behavioralMetricAmount(t, "income");
    const exp = behavioralMetricAmount(t, "expense");
    if (inc === 0 && exp === 0) continue;
    income = round2(income + inc);
    expense = round2(expense + exp);
    count += 1;
  }
  return { income, expense, count };
}

export function computeFinancialEvolution(
  input: FinancialEvolutionInput,
): EngineEnvelope<FinancialEvolutionFacts, EvolutionWindow, MonthPoint> {
  const specs: Array<{ key: EvolutionWindow["key"]; label: string; days: number; months: number }> = [
    { key: "30d", label: "Últimos 30 dias", days: 30, months: 1 },
    { key: "90d", label: "Últimos 90 dias", days: 90, months: 3 },
    { key: "180d", label: "Últimos 180 dias", days: 180, months: 6 },
  ];

  const windows: EvolutionWindow[] = specs.map((spec) => {
    const period = windowOf(input.today, spec.days);
    const agg = aggregate(input.txs, period);
    return {
      key: spec.key,
      label: spec.label,
      from: period.from,
      to: period.to,
      income: agg.income,
      expense: agg.expense,
      net: round2(agg.income - agg.expense),
      expense_monthly_avg: round2(agg.expense / spec.months),
      savings_rate: agg.income > 0 ? round2((agg.income - agg.expense) / agg.income) : null,
      transactions: agg.count,
    };
  });

  // Série mensal dentro de 180 dias.
  const months = new Map<string, MonthPoint>();
  const start = shiftDays(input.today, -179);
  for (const t of input.txs) {
    const d = t.occurred_at.slice(0, 10);
    if (d < start || d > input.today) continue;
    const inc = behavioralMetricAmount(t, "income");
    const exp = behavioralMetricAmount(t, "expense");
    if (inc === 0 && exp === 0) continue;
    const key = monthKey(d);
    const point = months.get(key) ?? { month: key, income: 0, expense: 0, net: 0 };
    point.income = round2(point.income + inc);
    point.expense = round2(point.expense + exp);
    point.net = round2(point.income - point.expense);
    months.set(key, point);
  }
  const series = [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));

  const expenses = series.map((m) => m.expense).filter((v) => v > 0);
  const medianExpense = medianOf(expenses);
  const volatility = medianExpense > 0 ? round2(stdDevOf(expenses) / medianExpense) : null;

  const w30 = windows.find((w) => w.key === "30d")!;
  const w90 = windows.find((w) => w.key === "90d")!;
  const w180 = windows.find((w) => w.key === "180d")!;
  const trendPct = safePct(w30.expense_monthly_avg, w90.expense_monthly_avg);

  const trend: FinancialEvolutionFacts["trend"] =
    trendPct === null || Math.abs(trendPct) < 8 ? "estavel" : trendPct > 0 ? "piorando" : "melhorando";

  const stability: FinancialEvolutionFacts["stability"] =
    volatility === null ? "media" : volatility <= 0.15 ? "alta" : volatility <= 0.35 ? "media" : "baixa";

  const sorted = [...series].sort((a, b) => b.net - a.net);

  return makeEnvelope({
    engine: "financial_evolution",
    facts: {
      expense_trend_pct: trendPct,
      trend,
      savings_rate_30d: w30.savings_rate,
      savings_rate_180d: w180.savings_rate,
      expense_volatility: volatility,
      stability,
      months_positive: series.filter((m) => m.net > 0).length,
      months_negative: series.filter((m) => m.net < 0).length,
      best_month: sorted[0] ?? null,
      worst_month: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    },
    breakdown: windows,
    drivers: series.slice(-3),
    evidence: makeEvidence({
      period: { from: w180.from, to: w180.to },
      comparisonPeriod: { from: w90.from, to: w90.to },
      sampleSize: w180.transactions,
      formulaVersion: FINANCIAL_EVOLUTION_VERSION,
      notes: [
        "Tendência compara a média mensal de gasto dos últimos 30 dias com a dos últimos 90 dias.",
        "Volatilidade é o coeficiente de variação do gasto mensal (desvio padrão / mediana).",
      ],
    }),
    confidence: confidenceFromSample(series.length, { minSample: 2, goodSample: 5 }),
  });
}
