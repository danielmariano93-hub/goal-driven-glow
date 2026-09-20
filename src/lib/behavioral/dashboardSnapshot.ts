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
  ObservedDimension,
} from "@/lib/behavioral/mapCycle";

const CADENCE_DAYS = 30;
const DAY_MS = 86_400_000;

type FinancialRow = {
  payload?: Record<string, unknown> | null;
  as_of_date?: string | null;
  computed_at?: string | null;
  available_balance?: number | null;
};

type TransactionStats = { count?: number; categorized?: number };

type DashboardPayload = {
  server_now?: string;
  checkins?: EmotionalCheckinRow[];
  assessments?: ExtendedBehavioralAssessment[];
  experiments?: BehaviorExperiment[];
  templates?: BehaviorExperimentTemplate[];
  hypotheses?: BehaviorHypothesis[];
  financial_snapshot?: FinancialRow | null;
  transaction_stats?: TransactionStats | null;
};

export type BehavioralDashboardState = BehavioralEvolutionSnapshot & {
  observed: ObservedBehaviorProfile;
  cycle: AssessmentCycle;
  degradedSources: string[];
};

function clamp(value: number, min = 0, max = 10) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number | null, decimals = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emptyDimension(evidence = "Ainda não há evidência suficiente."): ObservedDimension {
  return { score: null, confidence: "low", evidence, source: "insufficient_data" };
}

function confidenceBySample(sample: number, medium = 10, high = 30): "low" | "medium" | "high" {
  if (sample >= high) return "high";
  if (sample >= medium) return "medium";
  return "low";
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

function buildObserved(
  financialRow: FinancialRow | null,
  checkins: EmotionalCheckinRow[],
  txStats: TransactionStats | null,
): ObservedBehaviorProfile {
  const payload = (financialRow?.payload ?? {}) as any;
  const snapshot = payload?.snapshot ?? {};
  const rhythm = snapshot?.rhythm ?? {};
  const current = rhythm?.current ?? {};
  const projection = snapshot?.projection ?? {};
  const netWorth = snapshot?.netWorth ?? {};
  const netWorthBridge = snapshot?.netWorthBridge ?? {};
  const performance = snapshot?.periodPerformance ?? {};
  const goals = Array.isArray(snapshot?.activeCategoryGoals) ? snapshot.activeCategoryGoals : [];

  const txCount = Number(txStats?.count ?? 0);
  const categorized = Number(txStats?.categorized ?? 0);
  const categoryCoverage = txCount > 0 ? categorized / txCount : null;
  const checkin30 = checkins.filter((row) => Date.now() - new Date(row.occurred_at).getTime() <= 30 * DAY_MS);

  const awareness: ObservedDimension = categoryCoverage == null
    ? emptyDimension("O Nino precisa de mais lançamentos confirmados para observar esta dimensão.")
    : {
        score: round(clamp((categoryCoverage * 0.7 + Math.min(1, checkin30.length / 10) * 0.3) * 10)),
        confidence: confidenceBySample(txCount, 15, 50),
        evidence: `${Math.round(categoryCoverage * 100)}% dos gastos recentes estão categorizados e houve ${checkin30.length} check-in${checkin30.length === 1 ? "" : "s"} em 30 dias.`,
        source: "transactions+checkins",
      };

  const projectionConfidence = projection?.confidence === "high" ? 1 : projection?.confidence === "medium" ? 0.75 : projection?.confidence ? 0.5 : null;
  const goalsOnTrack = goals.length
    ? goals.filter((goal: any) => ["on_track", "achieved"].includes(String(goal?.status))).length / goals.length
    : null;
  const planningScore = projectionConfidence == null && goalsOnTrack == null
    ? null
    : clamp(((projectionConfidence ?? 0.6) * 4) + ((goalsOnTrack ?? 0.6) * 6));
  const planning: ObservedDimension = planningScore == null
    ? emptyDimension("Ainda faltam compromissos ou metas suficientes para observar seu planejamento.")
    : {
        score: round(planningScore),
        confidence: goals.length >= 2 && projectionConfidence != null ? "high" : "medium",
        evidence: goals.length
          ? `${goals.filter((goal: any) => ["on_track", "achieved"].includes(String(goal?.status))).length} de ${goals.length} metas de categoria estão no ritmo, com projeção ${String(projection?.confidence ?? "parcial")}.`
          : `A projeção financeira está com confiança ${String(projection?.confidence ?? "parcial")}.`,
        source: "financial_snapshot.goals+projection",
      };

  const avgDelta = Number(snapshot?.averageDailyVariationPct);
  const baseControl = Number.isFinite(avgDelta) ? clamp(7 - avgDelta / 10) : null;
  const controlScore = baseControl == null && goalsOnTrack == null
    ? null
    : clamp((baseControl ?? 6) * 0.7 + (goalsOnTrack ?? 0.6) * 10 * 0.3);
  const control: ObservedDimension = controlScore == null
    ? emptyDimension("O Nino precisa de comparação suficiente de ritmo para observar controle de gasto.")
    : {
        score: round(controlScore),
        confidence: Number.isFinite(avgDelta) ? "high" : "medium",
        evidence: Number.isFinite(avgDelta)
          ? `Seu gasto médio diário está ${Math.abs(avgDelta).toFixed(0)}% ${avgDelta <= 0 ? "abaixo" : "acima"} do período comparável.`
          : `${Math.round((goalsOnTrack ?? 0) * 100)}% das metas acompanhadas estão no ritmo esperado.`,
        source: "financial_snapshot.rhythm+goals",
      };

  const typicalValues = Array.isArray(current?.series)
    ? current.series.map((row: any) => Number(row?.typicalAmount)).filter((value: number) => Number.isFinite(value) && value > 0)
    : [];
  const typicalMean = avg(typicalValues);
  const variance = typicalMean && typicalValues.length >= 7
    ? typicalValues.reduce((sum: number, value: number) => sum + (value - typicalMean) ** 2, 0) / typicalValues.length
    : null;
  const cv = variance != null && typicalMean ? Math.sqrt(variance) / typicalMean : null;
  const consistency: ObservedDimension = cv == null
    ? emptyDimension("Ainda não há dias suficientes para medir estabilidade do seu ritmo típico.")
    : {
        score: round(clamp(10 - cv * 5)),
        confidence: confidenceBySample(typicalValues.length, 10, 18),
        evidence: `O Nino comparou ${typicalValues.length} dias de gasto típico; quanto menor a oscilação, maior a consistência observada.`,
        source: "financial_snapshot.rhythm.series",
      };

  const expense = Number(snapshot?.monthlyTotals?.expense ?? 0);
  const free = Number(projection?.freeAfterKnownCommitments ?? 0);
  const projectedEnd = Number(projection?.projectedEndBalance ?? 0);
  const available = Number(snapshot?.availableToday ?? financialRow?.available_balance ?? 0);
  const assets = Number(netWorth?.assets ?? 0);
  const debts = Number(netWorth?.owed ?? 0);
  const debtAssetRatio = assets > 0 ? debts / assets : null;
  const freeRatio = expense > 0 ? free / expense : null;
  const securityScore = expense > 0
    ? clamp(2 + Math.min(1, Math.max(0, freeRatio ?? 0)) * 4 + (projectedEnd > 0 ? 2 : 0) + (available > 0 ? 2 : 0) - Math.min(2.5, (debtAssetRatio ?? 0) * 3))
    : null;
  const security: ObservedDimension = securityScore == null
    ? emptyDimension("Ainda não há um mês financeiro completo o bastante para observar sua margem de segurança.")
    : {
        score: round(securityScore),
        confidence: projection?.confidence === "high" ? "high" : "medium",
        evidence: `Após compromissos conhecidos, o snapshot projeta ${free >= 0 ? "margem positiva" : "pressão"} de caixa e fechamento ${projectedEnd >= 0 ? "positivo" : "negativo"}.`,
        source: "financial_snapshot.projection+net_worth",
      };

  const savingsRate = Number(performance?.savingsRate);
  const net = Number(netWorth?.net ?? 0);
  const wealthScore = Number.isFinite(savingsRate)
    ? clamp(2 + Math.max(-0.1, Math.min(0.4, savingsRate)) * 20 + (net > 0 ? 1 : 0))
    : null;
  const wealth: ObservedDimension = wealthScore == null
    ? emptyDimension("O Nino ainda não tem taxa de poupança suficiente para observar construção de patrimônio.")
    : {
        score: round(wealthScore),
        confidence: "medium",
        evidence: `A taxa de poupança do período está em ${Math.round(savingsRate * 100)}% e o patrimônio líquido está ${net >= 0 ? "positivo" : "negativo"}.`,
        source: "financial_snapshot.performance+net_worth",
      };

  const moodAverage = avg(checkin30.map(emotionalScore));
  const calm: ObservedDimension = moodAverage == null
    ? emptyDimension("Faça alguns check-ins para o Nino observar sua tranquilidade ao longo do tempo.")
    : {
        score: round(moodAverage),
        confidence: confidenceBySample(checkin30.length, 4, 10),
        evidence: `${checkin30.length} check-in${checkin30.length === 1 ? "" : "s"} nos últimos 30 dias, incluindo seu histórico anterior ao novo check-in multidimensional.`,
        source: "emotional_checkins.history",
      };

  const openingDebts = Number(netWorthBridge?.openingDebts);
  const closingDebts = Number(netWorthBridge?.closingDebts ?? debts);
  const debtReduction = openingDebts > 0 ? (openingDebts - closingDebts) / openingDebts : null;
  const debtBurden = assets > 0 ? closingDebts / assets : null;
  const debtScore = closingDebts === 0 && assets > 0
    ? 9.5
    : Number.isFinite(closingDebts) && closingDebts >= 0 && (debtReduction != null || debtBurden != null)
      ? clamp(5 + (debtReduction ?? 0) * 15 - (debtBurden ?? 0) * 3)
      : null;
  const debt: ObservedDimension = debtScore == null
    ? emptyDimension("Ainda faltam dados comparáveis de dívida para observar esta dimensão.")
    : {
        score: round(debtScore),
        confidence: openingDebts > 0 ? "high" : "medium",
        evidence: closingDebts === 0
          ? "Não há dívida financeira ativa registrada no snapshot atual."
          : `O saldo de dívidas está ${debtReduction != null && debtReduction > 0 ? "caindo" : "estável ou subindo"}; o Nino considera também o peso dessas dívidas sobre os ativos.`,
        source: "financial_snapshot.net_worth_bridge",
      };

  const dimensions: Record<BehaviorDimensionKey, ObservedDimension> = {
    awareness, planning, control, consistency, security, wealth, calm, debt,
  };
  const scored = Object.values(dimensions).map((row) => row.score).filter((value): value is number => value != null);

  return {
    overallScore: round(avg(scored)),
    coverage: scored.length,
    asOf: financialRow?.as_of_date ?? null,
    dimensions,
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
  const hypotheses = (payload.hypotheses ?? []).map((row) => ({ ...row, confidence: Number(row.confidence) }));

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

  const highlights: BehaviorHighlight[] = [];
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

  const observed = buildObserved(payload.financial_snapshot ?? null, checkins, payload.transaction_stats ?? null);
  const activeExperiments = experiments.filter((row) => row.status === "active");

  return {
    assessments,
    latestAssessment,
    previousAssessment,
    overallDelta,
    checkins,
    moodHistory,
    moodAverage30,
    moodTrend14,
    emotionSpend: {
      sufficient: false,
      pairedDays: 0,
      vulnerableDays: 0,
      comparisonDays: 0,
      vulnerableAverage: null,
      comparisonAverage: null,
      upliftPct: null,
    },
    experiments,
    activeExperiments,
    templates,
    recommendedTemplates: recommendedForDimension(templates, extremes.lowest),
    hypotheses,
    highlights: highlights.slice(0, 6),
    lowestDimension: extremes.lowest,
    strongestDimension: extremes.strongest,
    momentSignal: null,
    observed,
    cycle: assessmentCycle(assessments),
    degradedSources: [],
  };
}
