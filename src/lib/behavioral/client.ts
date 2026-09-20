import { supabase } from "@/integrations/supabase/client";

export type BehaviorDimensionKey =
  | "awareness"
  | "planning"
  | "control"
  | "consistency"
  | "security"
  | "wealth"
  | "calm"
  | "debt";

export const BEHAVIOR_DIMENSIONS: Array<{
  key: BehaviorDimensionKey;
  label: string;
  short: string;
  question: string;
}> = [
  { key: "awareness", label: "Consciência", short: "Consciência", question: "Quanto você entende hoje para onde seu dinheiro vai e por que você decide gastar?" },
  { key: "planning", label: "Planejamento", short: "Planejamento", question: "Quanto suas decisões financeiras costumam acontecer antes, e não depois do gasto?" },
  { key: "control", label: "Controle de impulso", short: "Controle", question: "Quanto você sente que consegue escolher antes de agir quando surge vontade de gastar?" },
  { key: "consistency", label: "Consistência", short: "Consistência", question: "Quanto seus bons hábitos financeiros sobrevivem às semanas mais corridas?" },
  { key: "security", label: "Segurança", short: "Segurança", question: "Quanto você sente que consegue absorver imprevistos sem perder o controle do mês?" },
  { key: "wealth", label: "Construção de patrimônio", short: "Patrimônio", question: "Quanto você está transformando renda em patrimônio de forma recorrente?" },
  { key: "calm", label: "Tranquilidade com dinheiro", short: "Tranquilidade", question: "Quanto o dinheiro ocupa sua cabeça de forma tranquila, sem pressão desnecessária?" },
  { key: "debt", label: "Relação com dívidas", short: "Dívidas", question: "Quanto você sente que suas dívidas e compromissos estão sob controle?" },
];

export type BehavioralAssessment = {
  id: string;
  user_id: string;
  scores: Record<BehaviorDimensionKey, number>;
  overall_score: number;
  source: string;
  version: string;
  created_at: string;
};

export type EmotionalCheckinRow = {
  id: string;
  occurred_at: string;
  mood: number;
  emotion_key?: string | null;
  declared_emotion_key?: string | null;
  trigger_label?: string | null;
  notes?: string | null;
  transaction_id?: string | null;
  financial_calm_score?: number | null;
  financial_control_score?: number | null;
  spending_urge_score?: number | null;
  context_key?: string | null;
};

export type BehaviorExperimentTemplate = {
  slug: string;
  title: string;
  description: string;
  dimension: BehaviorDimensionKey;
  tracking_kind: "checkin_count" | "no_spend_days" | "spend_reduction_pct" | "manual";
  target_value: number;
  duration_days: number;
  xp_reward: number;
  config: Record<string, unknown>;
};

export type BehaviorExperiment = {
  id: string;
  template_slug: string;
  title: string;
  dimension: BehaviorDimensionKey;
  tracking_kind: string;
  status: "active" | "completed" | "abandoned" | "expired";
  target_value: number;
  current_value: number;
  progress: number;
  baseline_value?: number | null;
  result_value?: number | null;
  result_delta_pct?: number | null;
  started_at: string;
  ends_at: string;
  completed_at?: string | null;
  metadata?: Record<string, unknown>;
};

export type BehaviorHypothesis = {
  id: string;
  kind: string;
  title: string;
  explanation: string;
  confidence: number;
  evidence?: Record<string, unknown>;
  status: string;
  user_feedback?: string | null;
  created_at: string;
};

export type BehaviorHighlight = {
  id: string;
  tone: "positive" | "attention" | "neutral";
  title: string;
  body: string;
  evidence?: Record<string, unknown>;
};

export type BehavioralEvolutionSnapshot = {
  assessments: BehavioralAssessment[];
  latestAssessment: BehavioralAssessment | null;
  previousAssessment: BehavioralAssessment | null;
  overallDelta: number | null;
  checkins: EmotionalCheckinRow[];
  moodHistory: Array<{ day: string; score: number; control: number | null; urge: number | null; emotion: string | null }>;
  moodAverage30: number | null;
  moodTrend14: number | null;
  emotionSpend: {
    sufficient: boolean;
    pairedDays: number;
    vulnerableDays: number;
    comparisonDays: number;
    vulnerableAverage: number | null;
    comparisonAverage: number | null;
    upliftPct: number | null;
  };
  experiments: BehaviorExperiment[];
  activeExperiments: BehaviorExperiment[];
  templates: BehaviorExperimentTemplate[];
  recommendedTemplates: BehaviorExperimentTemplate[];
  hypotheses: BehaviorHypothesis[];
  highlights: BehaviorHighlight[];
  lowestDimension: BehaviorDimensionKey | null;
  strongestDimension: BehaviorDimensionKey | null;
  momentSignal: BehaviorHighlight | null;
};

function spDay(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, decimals = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

export function emotionalScore(row: EmotionalCheckinRow): number {
  if (row.financial_calm_score != null) return Number(row.financial_calm_score);
  return Math.max(0, Math.min(10, Number(row.mood || 0) * 2));
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

export async function loadBehavioralEvolution(userId: string): Promise<BehavioralEvolutionSnapshot> {
  const from90 = daysAgo(90);
  const from90Day = from90.slice(0, 10);
  const assessmentsTable = supabase.from("behavioral_assessments" as never) as any;
  const experimentsTable = supabase.from("behavior_experiments" as never) as any;
  const templatesTable = supabase.from("behavior_experiment_templates" as never) as any;

  const [checkinResp, assessmentResp, experimentResp, templateResp, txResp, hypothesisResp] = await Promise.all([
    (supabase.from("emotional_checkins") as any)
      .select("id,occurred_at,mood,emotion_key,declared_emotion_key,trigger_label,notes,transaction_id,financial_calm_score,financial_control_score,spending_urge_score,context_key")
      .eq("user_id", userId).gte("occurred_at", from90).order("occurred_at", { ascending: false }).limit(120),
    assessmentsTable.select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
    experimentsTable.select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(30),
    templatesTable.select("*").eq("active", true).order("created_at", { ascending: true }),
    supabase.from("transactions")
      .select("amount,occurred_at,behavioral_day,status,type,movement_kind")
      .eq("user_id", userId).eq("status", "confirmed").eq("type", "expense")
      .gte("occurred_at", from90Day).limit(3000),
    supabase.from("behavior_hypotheses")
      .select("id,kind,title,explanation,confidence,evidence,status,user_feedback,created_at")
      .eq("user_id", userId).in("status", ["pending", "confirmed", "partial"])
      .order("updated_at", { ascending: false }).limit(12),
  ]);

  for (const response of [checkinResp, assessmentResp, experimentResp, templateResp, txResp, hypothesisResp]) {
    if (response.error) throw response.error;
  }

  let experiments = ((experimentResp.data ?? []) as BehaviorExperiment[]).map((row) => ({
    ...row,
    target_value: Number(row.target_value), current_value: Number(row.current_value), progress: Number(row.progress),
  }));
  const activeBeforeRefresh = experiments.filter((row) => row.status === "active");
  if (activeBeforeRefresh.length) {
    const refreshed = await Promise.all(activeBeforeRefresh.map(async (experiment) => {
      const { data, error } = await (supabase.rpc as any)("behavior_experiment_refresh", { p_experiment_id: experiment.id });
      return error ? experiment : data as BehaviorExperiment;
    }));
    const byId = new Map(refreshed.map((row) => [row.id, row]));
    experiments = experiments.map((row) => byId.get(row.id) ?? row);
  }

  const checkins = (checkinResp.data ?? []) as EmotionalCheckinRow[];
  const assessments = ((assessmentResp.data ?? []) as BehavioralAssessment[]).map((row) => ({ ...row, overall_score: Number(row.overall_score) }));
  const templates = ((templateResp.data ?? []) as BehaviorExperimentTemplate[]).map((row) => ({
    ...row,
    target_value: Number(row.target_value), duration_days: Number(row.duration_days), xp_reward: Number(row.xp_reward),
  }));
  const hypotheses = ((hypothesisResp.data ?? []) as BehaviorHypothesis[]).map((row) => ({ ...row, confidence: Number(row.confidence) }));

  const latestAssessment = assessments[0] ?? null;
  const previousAssessment = assessments[1] ?? null;
  const overallDelta = latestAssessment && previousAssessment
    ? round(latestAssessment.overall_score - previousAssessment.overall_score)
    : null;
  const extremes = dimensionExtremes(latestAssessment);

  const moodHistory = [...checkins].reverse().map((row) => ({
    day: spDay(row.occurred_at),
    score: emotionalScore(row),
    control: row.financial_control_score == null ? null : Number(row.financial_control_score),
    urge: row.spending_urge_score == null ? null : Number(row.spending_urge_score),
    emotion: row.declared_emotion_key ?? row.emotion_key ?? row.trigger_label ?? null,
  }));
  const today = new Date();
  const cutoff30 = today.getTime() - 30 * 86_400_000;
  const cutoff14 = today.getTime() - 14 * 86_400_000;
  const cutoff28 = today.getTime() - 28 * 86_400_000;
  const last30 = checkins.filter((row) => new Date(row.occurred_at).getTime() >= cutoff30);
  const recent14 = checkins.filter((row) => new Date(row.occurred_at).getTime() >= cutoff14).map(emotionalScore);
  const previous14 = checkins.filter((row) => {
    const time = new Date(row.occurred_at).getTime();
    return time >= cutoff28 && time < cutoff14;
  }).map(emotionalScore);
  const moodAverage30 = round(avg(last30.map(emotionalScore)));
  const recentAvg = avg(recent14);
  const previousAvg = avg(previous14);
  const moodTrend14 = recentAvg != null && previousAvg != null ? round(recentAvg - previousAvg) : null;

  const checkinByDay = new Map<string, EmotionalCheckinRow>();
  for (const row of checkins) if (!checkinByDay.has(spDay(row.occurred_at))) checkinByDay.set(spDay(row.occurred_at), row);
  const spendByDay = new Map<string, number>();
  for (const row of (txResp.data ?? []) as Array<{ amount: number; occurred_at: string; behavioral_day?: string | null; movement_kind?: string | null }>) {
    if ((row.movement_kind ?? "transaction") !== "transaction") continue;
    const day = String(row.behavioral_day ?? row.occurred_at).slice(0, 10);
    spendByDay.set(day, (spendByDay.get(day) ?? 0) + Number(row.amount || 0));
  }
  const paired = [...checkinByDay.entries()].map(([day, checkin]) => ({
    day, checkin, spend: spendByDay.get(day) ?? 0,
  }));
  const vulnerable = paired.filter(({ checkin }) => emotionalScore(checkin) <= 4 || Number(checkin.spending_urge_score ?? 0) >= 7);
  const comparison = paired.filter(({ checkin }) => emotionalScore(checkin) >= 6 && Number(checkin.spending_urge_score ?? 0) < 7);
  const vulnerableAverage = avg(vulnerable.map((row) => row.spend));
  const comparisonAverage = avg(comparison.map((row) => row.spend));
  const sufficient = vulnerable.length >= 3 && comparison.length >= 3 && paired.length >= 8 && (comparisonAverage ?? 0) > 0;
  const upliftPct = sufficient && vulnerableAverage != null && comparisonAverage != null
    ? round((vulnerableAverage / comparisonAverage - 1) * 100)
    : null;

  const highlights: BehaviorHighlight[] = [];
  if (sufficient && upliftPct != null && Math.abs(upliftPct) >= 20) {
    highlights.push({
      id: "emotion-spend",
      tone: upliftPct > 0 ? "attention" : "positive",
      title: upliftPct > 0 ? "Seu contexto emocional parece acompanhar o ritmo de gasto" : "Dias mais difíceis não estão virando mais gasto",
      body: upliftPct > 0
        ? `Nos dias em que você marcou menos tranquilidade ou mais vontade de gastar, o gasto médio ficou ${Math.abs(upliftPct).toFixed(0)}% acima dos dias mais tranquilos. É uma associação no seu histórico, não uma relação de causa.`
        : `Nos dias de menor tranquilidade, seu gasto médio ficou ${Math.abs(upliftPct).toFixed(0)}% abaixo dos demais dias. Seu histórico não mostra aumento de gasto nesses momentos.`,
      evidence: { paired_days: paired.length, vulnerable_days: vulnerable.length, comparison_days: comparison.length, uplift_pct: upliftPct },
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
  const activeExperiments = experiments.filter((row) => row.status === "active");
  const leadingExperiment = activeExperiments.sort((a, b) => b.progress - a.progress)[0];
  if (leadingExperiment && leadingExperiment.progress >= 35) {
    highlights.push({
      id: `experiment-${leadingExperiment.id}`,
      tone: "positive",
      title: "Seu experimento já está ganhando forma",
      body: `${leadingExperiment.title}: ${Math.round(leadingExperiment.progress)}% do caminho concluído. Continue até o fim para comparar antes e depois.`,
    });
  }
  for (const hypothesis of hypotheses.filter((row) => row.status === "confirmed" || row.status === "partial").slice(0, 2)) {
    highlights.push({
      id: `hypothesis-${hypothesis.id}`,
      tone: "neutral",
      title: hypothesis.title,
      body: hypothesis.explanation,
      evidence: hypothesis.evidence,
    });
  }

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
    emotionSpend: {
      sufficient,
      pairedDays: paired.length,
      vulnerableDays: vulnerable.length,
      comparisonDays: comparison.length,
      vulnerableAverage: round(vulnerableAverage, 2),
      comparisonAverage: round(comparisonAverage, 2),
      upliftPct,
    },
    experiments,
    activeExperiments,
    templates,
    recommendedTemplates: recommendedForDimension(templates, extremes.lowest),
    hypotheses,
    highlights: highlights.slice(0, 6),
    lowestDimension: extremes.lowest,
    strongestDimension: extremes.strongest,
    momentSignal,
  };
}

export async function saveBehavioralAssessment(scores: Record<BehaviorDimensionKey, number>) {
  const { data, error } = await (supabase.rpc as any)("behavioral_assessment_save", { p_scores: scores });
  if (error) throw error;
  return data as BehavioralAssessment;
}

export async function startBehaviorExperiment(slug: string) {
  const { data, error } = await (supabase.rpc as any)("behavior_experiment_start", { p_template_slug: slug });
  if (error) throw error;
  return data as BehaviorExperiment;
}

export async function logBehaviorExperiment(experimentId: string, note?: string) {
  const { data, error } = await (supabase.rpc as any)("behavior_experiment_log", {
    p_experiment_id: experimentId,
    p_value: 1,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as BehaviorExperiment;
}
