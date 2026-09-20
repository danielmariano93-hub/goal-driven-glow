import { supabase } from "@/integrations/supabase/client";
import {
  BEHAVIOR_DIMENSIONS,
  emotionalScore,
  type BehavioralAssessment,
  type BehavioralEvolutionSnapshot,
  type BehaviorDimensionKey,
  type BehaviorExperiment,
  type BehaviorExperimentTemplate,
  type BehaviorHighlight,
  type BehaviorHypothesis,
  type EmotionalCheckinRow,
} from "@/lib/behavioral/client";
import type {
  AssessmentCycle,
  ExtendedBehavioralAssessment,
  ObservedBehaviorProfile,
} from "@/lib/behavioral/mapCycle";
import {
  buildObservedProfileV2,
  type BehavioralAppActivityStats,
  type BehavioralGoalCycle,
  type BehavioralInvestmentStats,
  type BehavioralPlanningStats,
  type BehavioralTransactionStats,
} from "@/lib/behavioral/observedProfileV2";

const CADENCE_DAYS = 30;
const DAY_MS = 86_400_000;

type FinancialRow = {
  payload?: Record<string, unknown> | null;
  as_of_date?: string | null;
  computed_at?: string | null;
  available_balance?: number | null;
};

type ExpenseDay = { day: string; amount: number | string; tx_count?: number };

type DashboardPayload = {
  server_now?: string;
  methodology_version?: string;
  checkins?: EmotionalCheckinRow[];
  assessments?: ExtendedBehavioralAssessment[];
  experiments?: BehaviorExperiment[];
  templates?: BehaviorExperimentTemplate[];
  hypotheses?: BehaviorHypothesis[];
  financial_snapshot?: FinancialRow | null;
  transaction_stats?: BehavioralTransactionStats | null;
  expense_days?: ExpenseDay[];
  app_activity?: BehavioralAppActivityStats | null;
  goal_cycles?: BehavioralGoalCycle[];
  planning_stats?: BehavioralPlanningStats | null;
  investment_stats?: BehavioralInvestmentStats | null;
};

export type BehavioralDashboardState = BehavioralEvolutionSnapshot & {
  observed: ObservedBehaviorProfile;
  cycle: AssessmentCycle;
  degradedSources: string[];
};

function round(value: number | null, decimals = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeExperiment(row: BehaviorExperiment): BehaviorExperiment {
  return {
    ...row,
    target_value: Number(row.target_value),
    current_value: Number(row.current_value),
    progress: Number(row.progress),
    baseline_value: row.baseline_value == null ? null : Number(row.baseline_value),
    result_value: row.result_value == null ? null : Number(row.result_value),
    result_delta_pct: row.result_delta_pct == null ? null : Number(row.result_delta_pct),
  };
}

function safeDay(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dimensionExtremes(assessment: BehavioralAssessment | null) {
  if (!assessment) return { lowest: null as BehaviorDimensionKey | null, strongest: null as BehaviorDimensionKey | null };
  const ordered = BEHAVIOR_DIMENSIONS
    .map((dimension) => ({ key: dimension.key, value: Number(assessment.scores?.[dimension.key] ?? 0) }))
    .sort((a, b) => a.value - b.value);
  return { lowest: ordered[0]?.key ?? null, strongest: ordered.at(-1)?.key ?? null };
}

function recommendedForDimension(templates: BehaviorExperimentTemplate[], key: BehaviorDimensionKey | null) {
  const priority: Record<BehaviorDimensionKey, string[]> = {
    awareness: ["checkin-consistency-14d", "weekly-money-review"],
    planning: ["weekly-money-review", "pause-before-buying"],
    control: ["three-no-spend-days", "reduce-spend-10pct", "pause-before-buying"],
    consistency: ["checkin-consistency-14d", "weekly-money-review"],
    security: ["weekly-money-review", "reduce-spend-10pct"],
    wealth: ["small-wealth-moves", "weekly-money-review"],
    calm: ["pause-before-buying", "checkin-consistency-14d"],
    debt: ["weekly-money-review", "three-no-spend-days"],
  };
  const slugs = key ? priority[key] : ["checkin-consistency-14d", "weekly-money-review"];
  return slugs.map((slug) => templates.find((template) => template.slug === slug)).filter(Boolean) as BehaviorExperimentTemplate[];
}

function assessmentCycle(assessments: ExtendedBehavioralAssessment[]): AssessmentCycle {
  const latest = assessments[0] ?? null;
  const nextDueAt = latest?.next_due_at
    ?? (latest ? new Date(new Date(latest.created_at).getTime() + CADENCE_DAYS * DAY_MS).toISOString() : null);
  const msRemaining = nextDueAt ? new Date(nextDueAt).getTime() - Date.now() : null;
  const daysRemaining = msRemaining == null ? null : Math.max(0, Math.ceil(msRemaining / DAY_MS));
  const questionSetIndex = assessments.length % 3;
  const questionSet = (["wheel_set_a", "wheel_set_b", "wheel_set_c"] as const)[questionSetIndex];
  return {
    cadenceDays: CADENCE_DAYS,
    due: !latest || (msRemaining != null && msRemaining <= 0),
    nextDueAt,
    daysRemaining,
    questionSetIndex,
    questionSet,
  };
}

function dedupeHypotheses(rows: BehaviorHypothesis[]): BehaviorHypothesis[] {
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .filter((row) => {
      if (seen.has(row.kind)) return false;
      seen.add(row.kind);
      return true;
    });
}

function computeEmotionSpend(checkins: EmotionalCheckinRow[], expenseDays: ExpenseDay[]) {
  const checkinByDay = new Map<string, EmotionalCheckinRow>();
  for (const row of checkins) {
    const day = safeDay(row.occurred_at);
    if (!checkinByDay.has(day)) checkinByDay.set(day, row);
  }
  const spendByDay = new Map<string, number>();
  for (const row of expenseDays) {
    const value = Number(row.amount);
    if (Number.isFinite(value)) spendByDay.set(String(row.day).slice(0, 10), value);
  }
  const paired = [...checkinByDay.entries()]
    .filter(([day]) => spendByDay.has(day))
    .map(([day, checkin]) => ({ day, checkin, spend: spendByDay.get(day) ?? 0 }));
  const vulnerable = paired.filter(({ checkin }) => emotionalScore(checkin) <= 4 || Number(checkin.spending_urge_score ?? 0) >= 7);
  const comparison = paired.filter(({ checkin }) => emotionalScore(checkin) >= 6 && Number(checkin.spending_urge_score ?? 0) < 7);
  const vulnerableAverage = avg(vulnerable.map((row) => row.spend));
  const comparisonAverage = avg(comparison.map((row) => row.spend));
  const sufficient = vulnerable.length >= 3 && comparison.length >= 3 && paired.length >= 8 && (comparisonAverage ?? 0) > 0;
  const upliftPct = sufficient && vulnerableAverage != null && comparisonAverage != null
    ? round((vulnerableAverage / comparisonAverage - 1) * 100)
    : null;
  return {
    sufficient,
    pairedDays: paired.length,
    vulnerableDays: vulnerable.length,
    comparisonDays: comparison.length,
    vulnerableAverage: round(vulnerableAverage, 2),
    comparisonAverage: round(comparisonAverage, 2),
    upliftPct,
  };
}

export async function loadBehavioralDashboardSnapshot(): Promise<BehavioralDashboardState> {
  const { data, error } = await (supabase.rpc as any)("behavioral_dashboard_snapshot");
  if (error) throw error;
  const payload = (data ?? {}) as DashboardPayload;

  const checkins = (payload.checkins ?? []).filter((row) => Number.isFinite(new Date(row.occurred_at).getTime()));
  const assessments = (payload.assessments ?? []).map((row) => ({
    ...row,
    overall_score: Number(row.overall_score),
    observed_overall_score: row.observed_overall_score == null ? null : Number(row.observed_overall_score),
    observed_coverage: row.observed_coverage == null ? null : Number(row.observed_coverage),
  }));
  let experiments = (payload.experiments ?? []).map(normalizeExperiment);
  const activeBeforeRefresh = experiments.filter((row) => row.status === "active");
  if (activeBeforeRefresh.length) {
    const refreshed = await Promise.all(activeBeforeRefresh.map(async (experiment) => {
      const { data: refreshedRow, error: refreshError } = await (supabase.rpc as any)("behavior_experiment_refresh", { p_experiment_id: experiment.id });
      return refreshError || !refreshedRow ? experiment : normalizeExperiment(refreshedRow as BehaviorExperiment);
    }));
    const byId = new Map(refreshed.map((row) => [row.id, row]));
    experiments = experiments.map((row) => byId.get(row.id) ?? row);
  }
  const templates = (payload.templates ?? []).map((row) => ({
    ...row,
    target_value: Number(row.target_value),
    duration_days: Number(row.duration_days),
    xp_reward: Number(row.xp_reward),
  }));
  const hypotheses = dedupeHypotheses((payload.hypotheses ?? []).map((row) => ({ ...row, confidence: Number(row.confidence) })));

  const latestAssessment = assessments[0] ?? null;
  const previousAssessment = assessments[1] ?? null;
  const overallDelta = latestAssessment && previousAssessment
    ? round(Number(latestAssessment.overall_score) - Number(previousAssessment.overall_score))
    : null;
  const extremes = dimensionExtremes(latestAssessment);

  const moodHistory = [...checkins].reverse().map((row) => ({
    day: safeDay(row.occurred_at),
    score: emotionalScore(row),
    control: row.financial_control_score == null ? null : Number(row.financial_control_score),
    urge: row.spending_urge_score == null ? null : Number(row.spending_urge_score),
    emotion: row.declared_emotion_key ?? row.emotion_key ?? row.trigger_label ?? null,
  }));
  const now = Date.now();
  const last30 = checkins.filter((row) => now - new Date(row.occurred_at).getTime() <= 30 * DAY_MS);
  const recent14 = checkins.filter((row) => now - new Date(row.occurred_at).getTime() <= 14 * DAY_MS).map(emotionalScore);
  const previous14 = checkins.filter((row) => {
    const age = now - new Date(row.occurred_at).getTime();
    return age > 14 * DAY_MS && age <= 28 * DAY_MS;
  }).map(emotionalScore);
  const moodAverage30 = round(avg(last30.map(emotionalScore)));
  const recentAvg = avg(recent14);
  const previousAvg = avg(previous14);
  const moodTrend14 = recentAvg != null && previousAvg != null ? round(recentAvg - previousAvg) : null;
  const emotionSpend = computeEmotionSpend(checkins, payload.expense_days ?? []);

  const highlights: BehaviorHighlight[] = [];
  if (emotionSpend.sufficient && emotionSpend.upliftPct != null && Math.abs(emotionSpend.upliftPct) >= 20) {
    highlights.push({
      id: "emotion-spend",
      tone: emotionSpend.upliftPct > 0 ? "attention" : "positive",
      title: emotionSpend.upliftPct > 0 ? "Seu contexto emocional acompanha dias de gasto maior" : "Dias menos tranquilos não estão virando mais gasto",
      body: emotionSpend.upliftPct > 0
        ? `Nos dias pareados de menor tranquilidade ou maior vontade de gastar, o gasto médio ficou ${Math.abs(emotionSpend.upliftPct).toFixed(0)}% acima dos dias mais tranquilos. É associação, não causa.`
        : `Nos dias pareados de menor tranquilidade, o gasto médio ficou ${Math.abs(emotionSpend.upliftPct).toFixed(0)}% abaixo dos demais. Seu histórico não mostra aumento de gasto nesses momentos.`,
      evidence: { paired_days: emotionSpend.pairedDays, vulnerable_days: emotionSpend.vulnerableDays, comparison_days: emotionSpend.comparisonDays },
    });
  }
  if (moodTrend14 != null && Math.abs(moodTrend14) >= 0.8) {
    highlights.push({
      id: "mood-trend",
      tone: moodTrend14 > 0 ? "positive" : "attention",
      title: moodTrend14 > 0 ? "Sua tranquilidade com dinheiro melhorou" : "Seu dinheiro está pesando mais nas últimas semanas",
      body: `A média dos últimos 14 dias mudou ${Math.abs(moodTrend14).toFixed(1)} ponto${Math.abs(moodTrend14) >= 2 ? "s" : ""} versus as duas semanas anteriores.`,
    });
  }
  for (const hypothesis of hypotheses.filter((row) => row.status === "confirmed" || row.status === "partial").slice(0, 2)) {
    highlights.push({ id: `hypothesis-${hypothesis.id}`, tone: "neutral", title: hypothesis.title, body: hypothesis.explanation, evidence: hypothesis.evidence });
  }

  const observed = buildObservedProfileV2({
    financialRow: payload.financial_snapshot ?? null,
    checkins,
    txStats: payload.transaction_stats ?? null,
    appActivity: payload.app_activity ?? null,
    goalCycles: payload.goal_cycles ?? [],
    planningStats: payload.planning_stats ?? null,
    investmentStats: payload.investment_stats ?? null,
  });
  const activeExperiments = experiments.filter((row) => row.status === "active");
  const latest = checkins[0] ?? null;
  const latestAgeHours = latest ? (Date.now() - new Date(latest.occurred_at).getTime()) / 3_600_000 : Infinity;
  const momentSignal = latest && latestAgeHours <= 36 && emotionalScore(latest) <= 4 && Number(latest.spending_urge_score ?? 0) >= 8
    ? {
        id: "moment-signal",
        tone: "attention" as const,
        title: "Talvez valha criar uma pequena pausa hoje",
        body: "Você marcou pouca tranquilidade e muita vontade de gastar. Se aparecer uma compra não planejada, teste esperar alguns minutos antes de decidir — sem proibição e sem culpa.",
        evidence: { calm_score: emotionalScore(latest), spending_urge_score: latest.spending_urge_score },
      }
    : null;
  if (momentSignal) highlights.unshift(momentSignal);

  return {
    assessments,
    latestAssessment,
    previousAssessment,
    overallDelta,
    checkins,
    moodHistory,
    moodAverage30,
    moodTrend14,
    emotionSpend,
    experiments,
    activeExperiments,
    templates,
    recommendedTemplates: recommendedForDimension(templates, extremes.lowest),
    hypotheses,
    highlights: highlights.slice(0, 6),
    lowestDimension: extremes.lowest,
    strongestDimension: extremes.strongest,
    momentSignal,
    observed,
    cycle: assessmentCycle(assessments),
    degradedSources: [],
  };
}
