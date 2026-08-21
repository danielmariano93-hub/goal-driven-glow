// Inteligência longitudinal (`longitudinal_intelligence.v1`).
// ==========================================================
// Transforma o histórico do usuário em SÉRIE mensal determinística e detecta
// tendência, regime e ponto de virada (change-point) com matemática — a LLM
// nunca decide se o usuário "melhorou".
//
// Regras invioláveis (herdadas de finance_truth):
//  - `behavioralMetricAmount` é a ÚNICA porta de entrada de valor: transferências
//    internas, pagamento de fatura, aplicações/resgates, estornos, ajustes de
//    conciliação e lançamentos supersedidos já saem por lá.
//  - RESULTADO (sobra do mês) e COMPORTAMENTO (consumo flexível) são separados:
//    renda extraordinária nunca vira "melhora comportamental".
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  round2,
  type TransactionRow,
} from "./facts";
import { classifyFlexibility } from "./costStructure";
import {
  confidenceFromSample,
  makeEnvelope,
  makeEvidence,
  medianOf,
  safePct,
  stdDevOf,
  type EngineConfidence,
  type EngineEnvelope,
  type EnginePeriod,
} from "./engineEnvelope";

export const LONGITUDINAL_VERSION = "longitudinal_intelligence.v1";

export interface LongitudinalMonth {
  /** YYYY-MM */
  month: string;
  income: number;
  expense: number;
  /** Resultado do mês = renda − gasto (RESULTADO, não comportamento). */
  net: number;
  /** Consumo flexível/discricionário (COMPORTAMENTO). */
  flexible_expense: number;
  /** Custo estrutural do mês (não é escolha do mês). */
  structural_expense: number;
  /** Gasto sem classificação de flexibilidade. */
  undefined_expense: number;
  /** Taxa de poupança do mês (net/renda) — null quando não houve renda. */
  savings_rate: number | null;
  transactions: number;
  /** Mês ainda em curso na data de referência: NUNCA entra em tendência. */
  is_open_month: boolean;
  /** Dias já decorridos do mês na data de referência. */
  days_elapsed: number;
  /** Dias totais do mês. */
  days_in_month: number;
  /** Consumo flexível equivalente ao mês inteiro (só informativo, mês aberto). */
  flexible_expense_mtd_equivalent: number;
  /** Renda atípica isolada da baseline (13º, PLR, férias, venda pontual). */
  extraordinary_income: number;
  /** Gasto flexível atípico isolado da baseline (viagem, compra única). */
  extraordinary_expense: number;
  /** Consumo flexível já normalizado (sem o atípico) — base das tendências. */
  flexible_expense_normalized: number;
  /** Renda já normalizada (sem o atípico). */
  income_normalized: number;
}


export type TrendDirection = "melhorando" | "piorando" | "estavel" | "indefinido";

export interface LongitudinalTrend {
  metric: "net" | "flexible_expense" | "savings_rate" | "expense" | "income";
  direction: TrendDirection;
  /** Inclinação por mês (unidade da métrica). */
  slope_per_month: number;
  /** Média dos meses recentes vs anteriores. */
  recent_average: number;
  previous_average: number;
  change_pct: number | null;
  /** Meses consecutivos na mesma direção. */
  streak_months: number;
}

export interface ChangePoint {
  /** Mês em que o regime mudou (YYYY-MM). */
  month: string;
  metric: LongitudinalTrend["metric"];
  before_average: number;
  after_average: number;
  change_pct: number | null;
  direction: TrendDirection;
  /** Meses decorridos desde a virada. */
  duration_months: number;
  confidence: EngineConfidence;
}

export interface FlexibleCategorySeries {
  label: string;
  /** Série mensal (alinhada a `closed_months`) de gasto flexível da categoria. */
  monthly: number[];
}

export interface LongitudinalFacts {
  /** Série completa com movimento (inclui o mês aberto, marcado como tal). */
  months: LongitudinalMonth[];
  /** Só meses FECHADOS — única base de tendência, baseline e change-point. */
  closed_months: LongitudinalMonth[];
  months_analyzed: number;
  closed_months_analyzed: number;
  /** Mês em curso (informativo, com equivalente MTD) ou null. */
  open_month: LongitudinalMonth | null;
  /** Tendência do RESULTADO financeiro. */
  result_trend: LongitudinalTrend;
  /** Tendência do COMPORTAMENTO de consumo flexível. */
  behavior_trend: LongitudinalTrend;
  income_trend: LongitudinalTrend;
  /** Virada mais relevante detectada (ou null). */
  change_point: ChangePoint | null;
  /** Volatilidade do resultado (desvio padrão mensal). */
  net_volatility: number;
  /** Mediana robusta do consumo flexível normalizado — baseline pessoal. */
  flexible_median: number;
  /** Resultado acumulado no período (meses fechados). */
  cumulative_net: number;
  /** O resultado melhorou por renda extraordinária, não por comportamento? */
  result_driven_by_income: boolean;
  /** Meses com renda/gasto atípico isolado da baseline. */
  extraordinary_months: Array<{ month: string; extraordinary_income: number; extraordinary_expense: number }>;
  /** Fontes flexíveis por categoria (série mensal dos meses fechados). */
  flexible_by_category: FlexibleCategorySeries[];
}

export interface LongitudinalInput {
  txs: TransactionRow[];
  period: EnginePeriod;
  categoryNames?: Record<string, string>;
  /** Meses recentes considerados "agora" na comparação (default 3). */
  recentMonths?: number;
  /** Data de referência (YYYY-MM-DD) que define qual mês está aberto. */
  asOf?: string;
}


const EMPTY_TREND = (metric: LongitudinalTrend["metric"]): LongitudinalTrend => ({
  metric,
  direction: "indefinido",
  slope_per_month: 0,
  recent_average: 0,
  previous_average: 0,
  change_pct: null,
  streak_months: 0,
});

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Regressão linear simples: inclinação por mês (índice como x). */
function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : round2(num / den);
}

/** Direção de tendência. `higherIsBetter=false` inverte o sentido (gasto). */
function directionOf(
  slopePerMonth: number,
  scale: number,
  higherIsBetter: boolean,
): TrendDirection {
  const threshold = Math.max(1, Math.abs(scale) * 0.03);
  if (Math.abs(slopePerMonth) < threshold) return "estavel";
  const improving = higherIsBetter ? slopePerMonth > 0 : slopePerMonth < 0;
  return improving ? "melhorando" : "piorando";
}

function streakOf(values: number[], higherIsBetter: boolean): number {
  let streak = 0;
  for (let i = values.length - 1; i > 0; i--) {
    const delta = values[i] - values[i - 1];
    const good = higherIsBetter ? delta > 0 : delta < 0;
    if (!good) break;
    streak += 1;
  }
  return streak;
}

function buildTrend(
  metric: LongitudinalTrend["metric"],
  values: number[],
  higherIsBetter: boolean,
  recentMonths: number,
): LongitudinalTrend {
  if (values.length < 2) return EMPTY_TREND(metric);
  const recent = values.slice(-recentMonths);
  const previous = values.slice(0, Math.max(0, values.length - recentMonths));
  const recentAverage = avg(recent);
  const previousAverage = avg(previous);
  const s = slope(values);
  const scale = Math.max(Math.abs(previousAverage), Math.abs(recentAverage));
  return {
    metric,
    direction: directionOf(s, scale, higherIsBetter),
    slope_per_month: s,
    recent_average: recentAverage,
    previous_average: previousAverage,
    change_pct: previous.length ? safePct(Math.abs(recentAverage), Math.abs(previousAverage)) : null,
    streak_months: streakOf(values, higherIsBetter),
  };
}

/**
 * Change-point determinístico: para cada corte possível (mínimo 2 meses de cada
 * lado), mede a diferença absoluta entre as médias e escolhe o maior salto.
 * Sem heurística de LLM e sem "achismo" — só a série.
 */
function detectChangePoint(
  months: LongitudinalMonth[],
  metric: LongitudinalTrend["metric"],
  values: number[],
  higherIsBetter: boolean,
): ChangePoint | null {
  const n = values.length;
  if (n < 4) return null;
  let best: { index: number; gap: number; before: number; after: number } | null = null;
  for (let cut = 2; cut <= n - 2; cut++) {
    const before = avg(values.slice(0, cut));
    const after = avg(values.slice(cut));
    const gap = Math.abs(after - before);
    if (!best || gap > best.gap) best = { index: cut, gap, before, after };
  }
  if (!best) return null;
  const noise = stdDevOf(values);
  // Um salto só é virada quando supera o ruído da própria série.
  if (best.gap < Math.max(noise, Math.abs(best.before) * 0.15, 50)) return null;
  const improving = higherIsBetter ? best.after > best.before : best.after < best.before;
  return {
    month: months[best.index].month,
    metric,
    before_average: best.before,
    after_average: best.after,
    change_pct: safePct(Math.abs(best.after), Math.abs(best.before)),
    direction: improving ? "melhorando" : "piorando",
    duration_months: n - best.index,
    confidence: confidenceFromSample(n, { minSample: 4, goodSample: 10 }),
  };
}

function monthsBetween(period: EnginePeriod): string[] {
  const out: string[] = [];
  const [fy, fm] = period.from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = period.to.slice(0, 7).split("-").map(Number);
  let y = fy;
  let m = fm;
  // Guarda de segurança: no máximo 60 meses de série.
  for (let i = 0; i < 60; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (y === ty && m === tm) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function computeLongitudinal(
  input: LongitudinalInput,
): EngineEnvelope<LongitudinalFacts, LongitudinalMonth, ChangePoint> {
  const names = input.categoryNames ?? {};
  const recentMonths = Math.max(1, input.recentMonths ?? 3);
  const attribution = buildRefundAttribution(input.txs);
  const keys = monthsBetween(input.period);
  const byMonth = new Map<string, LongitudinalMonth>();
  for (const month of keys) {
    byMonth.set(month, {
      month, income: 0, expense: 0, net: 0,
      flexible_expense: 0, structural_expense: 0, undefined_expense: 0,
      savings_rate: null, transactions: 0,
    });
  }

  let sampleSize = 0;
  for (const t of input.txs) {
    const day = String(t.occurred_at ?? "").slice(0, 10);
    if (!day || day < input.period.from || day > input.period.to) continue;
    const row = byMonth.get(day.slice(0, 7));
    if (!row) continue;
    const income = behavioralMetricAmount(t, "income");
    if (income !== 0) {
      row.income = round2(row.income + income);
      row.transactions += 1;
      sampleSize += 1;
    }
    const expense = behavioralMetricAmount(t, "expense");
    if (expense !== 0) {
      row.expense = round2(row.expense + expense);
      row.transactions += 1;
      sampleSize += 1;
      const categoryId = effectiveCategoryId(t, attribution);
      const name = categoryId ? (names[categoryId] ?? "") : "";
      const flex = classifyFlexibility(name);
      if (flex === "flexivel") row.flexible_expense = round2(row.flexible_expense + expense);
      else if (flex === "estrutural") row.structural_expense = round2(row.structural_expense + expense);
      else row.undefined_expense = round2(row.undefined_expense + expense);
    }
  }

  const months = keys.map((k) => {
    const row = byMonth.get(k)!;
    row.net = round2(row.income - row.expense);
    row.savings_rate = row.income > 0 ? Math.round((row.net / row.income) * 10000) / 100 : null;
    return row;
  });
  // Só meses com movimento entram na série — mês sem dado não é mês de melhora.
  const active = months.filter((m) => m.transactions > 0);

  const netSeries = active.map((m) => m.net);
  const flexSeries = active.map((m) => m.flexible_expense);
  const incomeSeries = active.map((m) => m.income);
  const expenseSeries = active.map((m) => m.expense);

  const resultTrend = buildTrend("net", netSeries, true, recentMonths);
  const behaviorTrend = buildTrend("flexible_expense", flexSeries, false, recentMonths);
  const incomeTrend = buildTrend("income", incomeSeries, true, recentMonths);
  const expenseTrend = buildTrend("expense", expenseSeries, false, recentMonths);

  const netChange = detectChangePoint(active, "net", netSeries, true);
  const behaviorChange = detectChangePoint(active, "flexible_expense", flexSeries, false);
  const changePoint = !netChange ? behaviorChange
    : !behaviorChange ? netChange
    : Math.abs(netChange.after_average - netChange.before_average)
      >= Math.abs(behaviorChange.after_average - behaviorChange.before_average)
      ? netChange : behaviorChange;

  // RESULTADO vs COMPORTAMENTO: se a sobra melhorou mas o consumo flexível não
  // caiu (e a renda subiu), a melhora é de renda — nunca de comportamento.
  const resultDrivenByIncome = resultTrend.direction === "melhorando"
    && behaviorTrend.direction !== "melhorando"
    && incomeTrend.direction === "melhorando";

  const notes: string[] = [
    "resultado (sobra) e comportamento (consumo flexível) são medidos separadamente",
  ];
  if (resultDrivenByIncome) {
    notes.push("a melhora do resultado é explicada por renda maior, não por mudança de consumo");
  }
  if (active.length < 4) notes.push("série curta: tendência ainda não é conclusiva");

  const facts: LongitudinalFacts = {
    months: active,
    months_analyzed: active.length,
    result_trend: resultTrend,
    behavior_trend: behaviorTrend,
    income_trend: incomeTrend,
    change_point: changePoint,
    net_volatility: round2(stdDevOf(netSeries)),
    flexible_median: round2(medianOf(flexSeries)),
    cumulative_net: round2(netSeries.reduce((a, b) => a + b, 0)),
    result_driven_by_income: resultDrivenByIncome,
  };

  return makeEnvelope<LongitudinalFacts, LongitudinalMonth, ChangePoint>({
    engine: LONGITUDINAL_VERSION,
    facts,
    breakdown: active,
    drivers: changePoint ? [changePoint] : [],
    evidence: makeEvidence({
      period: input.period,
      sampleSize,
      formulaVersion: LONGITUDINAL_VERSION,
      notes: [...notes, `tendência de gasto: ${expenseTrend.direction}`],
    }),
    confidence: confidenceFromSample(active.length, { minSample: 3, goodSample: 8 }),
  });
}
