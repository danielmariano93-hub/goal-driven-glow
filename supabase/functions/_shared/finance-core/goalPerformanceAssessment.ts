// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
/**
 * Motor determinístico `goal_performance_assessment.v1`.
 *
 * Responde perguntas COMPOSTAS de meta + evolução:
 * "como estão minhas metas, se atingi ou ultrapassei, e compare essas mesmas
 *  categorias com o mesmo período do mês passado".
 *
 * Regra de domínio central: ATINGIR META != EVOLUIR FINANCEIRAMENTE.
 * As duas verdades são calculadas separadamente e cruzadas em um estado
 * explícito por categoria. A LLM não calcula nada aqui.
 *
 * Este motor NÃO cria fórmula de gasto: ele COMPÕE
 * `evaluateCategoryGoal` (meta) com a soma canônica de despesa comportamental
 * (`behavioralMetricAmount` + `effectiveCategoryId` + `buildRefundAttribution`
 * + `isRealMonthlyMovement`), exatamente as mesmas regras da avaliação de meta.
 */
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  isRealMonthlyMovement,
  reportingCompetenceDate,
  round2,
  type TransactionRow,
} from "./facts.ts";

import {
  evaluateCategoryGoal,
  type CategoryGoalEvaluation,
  type CategorySpendingGoalRow,
} from "./metrics.ts";

export const GOAL_PERFORMANCE_VERSION = "goal_performance_assessment.v1";

export type GoalAttainmentStatus = "achieved" | "missed" | "scheduled" | "paused";

export type HistoricalTrend =
  | "strongly_improved"
  | "improved"
  | "stable"
  | "worsened"
  | "strongly_worsened"
  | "insufficient_data";

export type GoalPerformanceState =
  | "goal_achieved_and_improved"
  | "goal_achieved_but_worsened"
  | "goal_missed_but_improved"
  | "goal_missed_and_worsened"
  | "insufficient_data";

export type EngineConfidenceLevel = "insufficient" | "low" | "medium" | "high";

export type GoalPerformancePeriod = { from: string; to: string; label?: string };
export type ComparisonDirection = "below" | "above" | "equal";
export type ComparisonMateriality = "material_improvement" | "material_worsening" | "immaterial_change";
export type GoalComparisonBasis = "calendar_previous_month" | "preceding_window";

export type GoalPerformanceCategory = {
  category_id: string;
  category_name: string;
  goal_id: string;
  goal_period: GoalPerformancePeriod;
  analysis_period: GoalPerformancePeriod;
  period_compatibility: "compatible" | "incompatible";
  goal: {
    target: number;
    actual: number;
    /** actual - target (positivo = estourou). */
    delta: number;
    delta_pct: number | null;
    status: GoalAttainmentStatus;
  };
  historical: {
    current: number;
    previous: number;
    /** current - previous (negativo = gastou menos que antes). */
    delta: number;
    delta_pct: number | null;
    trend: HistoricalTrend;
    direction: ComparisonDirection;
    materiality: ComparisonMateriality;
    confidence: EngineConfidenceLevel;
  };
  interpretation: { state: GoalPerformanceState };
};

export type GoalPerformanceAssessment = {
  formula_version: typeof GOAL_PERFORMANCE_VERSION;
  period: {
    current: GoalPerformancePeriod;
    comparison: GoalPerformancePeriod;
    comparison_basis: GoalComparisonBasis;
    methodology: string;
  };
  freshness: {
    ledger_version: number | null;
    computed_at: string;
    source: "ledger" | "derived_cache";
    stale: boolean;
  };
  categories: GoalPerformanceCategory[];
  aggregate: {
    scope: "scoped_entities";
    entity_ids: string[];
    total_target: number;
    current_spend: number;
    previous_spend: number;
    vs_target: number;
    vs_target_pct: number | null;
    vs_previous: number;
    vs_previous_pct: number | null;
    direction: ComparisonDirection;
  };
  conclusions: {
    goals_total: number;
    goals_achieved: number;
    goals_missed: number;
    improved_count: number;
    worsened_count: number;
    below_count: number;
    above_count: number;
    equal_count: number;
    material_improvement_count: number;
    material_worsening_count: number;
    goal_attainment_summary: string;
    behavioral_evolution: "improving" | "worsening" | "mixed" | "stable" | "insufficient_data";
    strongest_improvement: { category_name: string; delta: number } | null;
    strongest_deterioration: { category_name: string; delta: number } | null;
    priority: { category_name: string; reason: string } | null;
  };
  confidence: EngineConfidenceLevel;
  data_quality: { goals_evaluated: number; transactions_considered: number; comparable_periods: boolean };
  evidence: Array<{
    claim: string;
    metric: string;
    current: number;
    previous: number | null;
    source: string;
    period: GoalPerformancePeriod;
  }>;
  formula_versions: string[];
};

const MATERIALITY_FLOOR = 50; // R$ — mesmo piso usado pelo motor de performance.
const STRONG_PCT = 25;
const MOVE_PCT = 5;

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysInclusive(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * "Mesmo período do mês passado" — deslocamento canônico de um mês
 * preservando os dias do recorte atual, com clamp no último dia do mês.
 */
export function samePeriodPreviousMonth(period: { from: string; to: string }): { from: string; to: string } {
  const shift = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00`);
    const targetMonth = d.getMonth() - 1;
    const probe = new Date(d.getFullYear(), targetMonth + 1, 0); // último dia do mês alvo
    const day = Math.min(d.getDate(), probe.getDate());
    return isoOf(new Date(probe.getFullYear(), probe.getMonth(), day));
  };
  return { from: shift(period.from), to: shift(period.to) };
}

/**
 * Soma canônica de despesa comportamental de UMA categoria num período.
 * Mesmas exclusões da avaliação de meta: superseded fora, estorno abate a
 * categoria econômica original, transferência/fatura/aporte não são consumo.
 */
export function categorySpendInPeriod(
  txs: TransactionRow[],
  categoryId: string,
  period: { from: string; to: string },
  attribution?: Map<string, string | null>,
): { amount: number; rows: number } {
  const attr = attribution ?? buildRefundAttribution(txs);
  let total = 0;
  let rows = 0;
  for (const t of txs) {
    if (String(t.status ?? "confirmed") === "superseded") continue;
    if (effectiveCategoryId(t, attr) !== categoryId) continue;
    const day = reportingCompetenceDate(t);
    if (day < period.from || day > period.to) continue;
    if (String(t.movement_kind ?? "") === "refund") {
      const credit = behavioralMetricAmount(t, "expense");
      if (credit === 0) continue;
      total += credit;
      continue;
    }
    if (t.type !== "expense") continue;
    if (!isRealMonthlyMovement(t)) continue;
    total += Number(t.amount || 0);
    rows += 1;
  }
  return { amount: round2(Math.max(0, total)), rows };
}

export function classifyTrend(current: number, previous: number): HistoricalTrend {
  if (previous <= 0 && current <= 0) return "insufficient_data";
  const delta = current - previous;
  if (Math.abs(delta) < MATERIALITY_FLOOR) return "stable";
  if (previous <= 0) return current >= MATERIALITY_FLOOR ? "strongly_worsened" : "stable";
  const pct = (delta / previous) * 100;
  if (pct <= -STRONG_PCT) return "strongly_improved";
  if (pct <= -MOVE_PCT) return "improved";
  if (pct >= STRONG_PCT) return "strongly_worsened";
  if (pct >= MOVE_PCT) return "worsened";
  return "stable";
}

export function comparisonDirection(delta: number): ComparisonDirection {
  return delta < 0 ? "below" : delta > 0 ? "above" : "equal";
}

export function comparisonMateriality(trend: HistoricalTrend): ComparisonMateriality {
  if (isImproving(trend)) return "material_improvement";
  if (isWorsening(trend)) return "material_worsening";
  return "immaterial_change";
}

function isImproving(trend: HistoricalTrend): boolean {
  return trend === "improved" || trend === "strongly_improved";
}
function isWorsening(trend: HistoricalTrend): boolean {
  return trend === "worsened" || trend === "strongly_worsened";
}

export function crossState(status: GoalAttainmentStatus, trend: HistoricalTrend): GoalPerformanceState {
  if (trend === "insufficient_data" || status === "scheduled" || status === "paused") return "insufficient_data";
  const achieved = status === "achieved";
  if (achieved && !isWorsening(trend)) return "goal_achieved_and_improved";
  if (achieved && isWorsening(trend)) return "goal_achieved_but_worsened";
  if (!achieved && isImproving(trend)) return "goal_missed_but_improved";
  return "goal_missed_and_worsened";
}

function attainmentOf(ev: CategoryGoalEvaluation): GoalAttainmentStatus {
  const status = String(ev.status ?? "");
  if (status === "scheduled") return "scheduled";
  if (status === "paused") return "paused";
  return ev.actualSpend > ev.targetAmount ? "missed" : "achieved";
}

function confidenceOf(rows: number, comparable: boolean): EngineConfidenceLevel {
  if (rows === 0) return "insufficient";
  if (!comparable) return "low";
  if (rows >= 12) return "high";
  if (rows >= 4) return "medium";
  return "low";
}

function pct(delta: number, base: number): number | null {
  if (base <= 0) return null;
  return Math.round((delta / base) * 10000) / 100;
}

export type GoalPerformanceInput = {
  goals: CategorySpendingGoalRow[];
  txs: TransactionRow[];
  categoryNameById?: Record<string, string>;
  today: Date;
  /** Recorte atual explícito do plano analítico. */
  current?: { from: string; to: string };
  /** Recorte de comparação; default = mesmo período do mês anterior. */
  comparison?: { from: string; to: string };
  comparison_basis?: GoalComparisonBasis;
  /** Escopo explícito (ids de categoria) quando o turno o preserva. */
  entity_ids?: string[];
  freshness?: { ledger_version: number | null; source: "ledger" | "derived_cache"; stale: boolean };
};

export function computeGoalPerformanceAssessment(input: GoalPerformanceInput): GoalPerformanceAssessment {
  const names = input.categoryNameById ?? {};
  const ledger = (input.txs ?? []).filter((t) => String(t.status ?? "confirmed") !== "superseded");
  const attribution = buildRefundAttribution(ledger);

  const scoped = (input.goals ?? [])
    .filter((g) => String(g.status ?? "active") === "active")
    .filter((g) => !input.entity_ids?.length || input.entity_ids.includes(g.category_id));

  const evaluations = scoped.map((goal) => ({
    goal,
    ev: evaluateCategoryGoal(goal, ledger, input.today, names[goal.category_id]),
  }));

  // Recorte atual: a menor janela comum das metas (todas mensais → o próprio
  // período da meta). Comparação: mesmo recorte no mês anterior.
  const currentFrom = evaluations.length
    ? evaluations.map((e) => e.ev.period.start).sort()[0]
    : `${isoOf(input.today).slice(0, 7)}-01`;
  const currentTo = evaluations.length
    ? evaluations.map((e) => e.ev.calculationReferenceDate).sort().slice(-1)[0]
    : isoOf(input.today);
  const current: GoalPerformancePeriod = input.current ?? { from: currentFrom, to: currentTo };
  const comparison: GoalPerformancePeriod = input.comparison ?? samePeriodPreviousMonth(current);

  const comparable = Math.abs(daysInclusive(current.from, current.to) - daysInclusive(comparison.from, comparison.to)) <= 1;

  let rowsConsidered = 0;
  const categories: GoalPerformanceCategory[] = evaluations.map(({ goal, ev }) => {
    const cur = categorySpendInPeriod(ledger, goal.category_id, { from: current.from, to: current.to }, attribution);
    const prev = categorySpendInPeriod(ledger, goal.category_id, { from: comparison.from, to: comparison.to }, attribution);
    rowsConsidered += cur.rows + prev.rows;
    const status = attainmentOf(ev);
    const trend = classifyTrend(cur.amount, prev.amount);
    const goalDelta = round2(ev.actualSpend - ev.targetAmount);
    const histDelta = round2(cur.amount - prev.amount);
    const direction = comparisonDirection(histDelta);
    const goalPeriod = { from: ev.period.start, to: ev.calculationReferenceDate };
    const periodCompatibility = goalPeriod.from === current.from && goalPeriod.to === current.to
      ? "compatible" as const
      : "incompatible" as const;
    return {
      category_id: goal.category_id,
      category_name: ev.categoryName ?? names[goal.category_id] ?? "Categoria",
      goal_id: String(goal.id ?? ""),
      goal_period: goalPeriod,
      analysis_period: { from: current.from, to: current.to },
      period_compatibility: periodCompatibility,
      goal: {
        target: round2(ev.targetAmount),
        actual: round2(ev.actualSpend),
        delta: goalDelta,
        delta_pct: pct(goalDelta, ev.targetAmount),
        status,
      },
      historical: {
        current: cur.amount,
        previous: prev.amount,
        delta: histDelta,
        delta_pct: pct(histDelta, prev.amount),
        trend,
        direction,
        materiality: comparisonMateriality(trend),
        confidence: confidenceOf(cur.rows + prev.rows, comparable),
      },
      interpretation: { state: crossState(status, trend) },
    };
  });

  const totalTarget = round2(categories.reduce((s, c) => s + c.goal.target, 0));
  const curSpend = round2(categories.reduce((s, c) => s + c.historical.current, 0));
  const prevSpend = round2(categories.reduce((s, c) => s + c.historical.previous, 0));
  const vsTarget = round2(curSpend - totalTarget);
  const vsPrevious = round2(curSpend - prevSpend);

  const achieved = categories.filter((c) => c.goal.status === "achieved").length;
  const missed = categories.filter((c) => c.goal.status === "missed").length;
  const improved = categories.filter((c) => isImproving(c.historical.trend)).length;
  const worsened = categories.filter((c) => isWorsening(c.historical.trend)).length;
  const below = categories.filter((c) => c.historical.direction === "below").length;
  const above = categories.filter((c) => c.historical.direction === "above").length;
  const equal = categories.filter((c) => c.historical.direction === "equal").length;

  const bestImprovement = [...categories].sort((a, b) => a.historical.delta - b.historical.delta)[0] ?? null;
  const worstDeterioration = [...categories].sort((a, b) => b.historical.delta - a.historical.delta)[0] ?? null;

  const priorityCategory = categories.find((c) => c.interpretation.state === "goal_missed_and_worsened")
    ?? categories.find((c) => c.interpretation.state === "goal_achieved_but_worsened")
    ?? categories.find((c) => c.goal.status === "missed")
    ?? null;

  const behavioral_evolution: GoalPerformanceAssessment["conclusions"]["behavioral_evolution"] =
    categories.length === 0 || categories.every((c) => c.historical.trend === "insufficient_data")
      ? "insufficient_data"
      : improved > 0 && worsened === 0
        ? "improving"
        : worsened > 0 && improved === 0
          ? "worsening"
          : improved > 0 && worsened > 0
            ? "mixed"
            : "stable";

  const evidence = categories.map((c) => ({
    claim: `${c.category_name}: ${c.interpretation.state}`,
    metric: "category_expense",
    current: c.historical.current,
    previous: c.historical.previous,
    source: GOAL_PERFORMANCE_VERSION,
    period: current,
  }));

  const confidence: EngineConfidenceLevel = categories.length === 0
    ? "insufficient"
    : categories.map((c) => c.historical.confidence).sort(
      (a, b) => rankConfidence(a) - rankConfidence(b),
    )[0];

  return {
    formula_version: GOAL_PERFORMANCE_VERSION,
    period: {
      current,
      comparison,
      comparison_basis: input.comparison_basis ?? "calendar_previous_month",
      methodology: `Metas por categoria avaliadas no recorte ${current.from} a ${current.to}`
        + ` e comparadas com ${comparison.from} a ${comparison.to}`
        + `${comparable ? "" : " (janelas de tamanhos diferentes)"}.`
        + " Gasto comportamental líquido de estornos; transferências, aportes e pagamento de fatura fora.",
    },
    freshness: {
      ledger_version: input.freshness?.ledger_version ?? null,
      computed_at: new Date().toISOString(),
      source: input.freshness?.source ?? "ledger",
      stale: Boolean(input.freshness?.stale),
    },
    categories,
    aggregate: {
      scope: "scoped_entities",
      entity_ids: categories.map((c) => c.category_id),
      total_target: totalTarget,
      current_spend: curSpend,
      previous_spend: prevSpend,
      vs_target: vsTarget,
      vs_target_pct: pct(vsTarget, totalTarget),
      vs_previous: vsPrevious,
      vs_previous_pct: pct(vsPrevious, prevSpend),
      direction: comparisonDirection(vsPrevious),
    },
    conclusions: {
      goals_total: categories.length,
      goals_achieved: achieved,
      goals_missed: missed,
      improved_count: improved,
      worsened_count: worsened,
      below_count: below,
      above_count: above,
      equal_count: equal,
      material_improvement_count: improved,
      material_worsening_count: worsened,
      goal_attainment_summary: categories.length === 0
        ? "Você ainda não tem metas por categoria ativas."
        : missed === 0
          ? `Todas as ${categories.length} metas estão dentro do teto.`
          : `${missed} de ${categories.length} metas estouraram o teto.`,
      behavioral_evolution,
      strongest_improvement: bestImprovement && bestImprovement.historical.delta < 0
        ? { category_name: bestImprovement.category_name, delta: bestImprovement.historical.delta }
        : null,
      strongest_deterioration: worstDeterioration && worstDeterioration.historical.delta > 0
        ? { category_name: worstDeterioration.category_name, delta: worstDeterioration.historical.delta }
        : null,
      priority: priorityCategory
        ? {
          category_name: priorityCategory.category_name,
          reason: priorityCategory.interpretation.state === "goal_missed_and_worsened"
            ? "estourou a meta e gastou mais que no período anterior"
            : priorityCategory.interpretation.state === "goal_achieved_but_worsened"
              ? "está dentro do teto, mas gastou mais que no período anterior"
              : "estourou a meta definida",
        }
        : null,
    },
    confidence,
    data_quality: {
      goals_evaluated: categories.length,
      transactions_considered: rowsConsidered,
      comparable_periods: comparable,
    },
    evidence,
    formula_versions: [GOAL_PERFORMANCE_VERSION, "category_goal.v1", "finance_contract.v4"],
  };
}

function rankConfidence(c: EngineConfidenceLevel): number {
  return c === "high" ? 3 : c === "medium" ? 2 : c === "low" ? 1 : 0;
}
