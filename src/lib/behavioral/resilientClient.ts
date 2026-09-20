import { supabase } from "@/integrations/supabase/client";
import {
  BEHAVIOR_DIMENSIONS,
  emotionalScore,
  loadBehavioralEvolution,
  type BehavioralAssessment,
  type BehavioralEvolutionSnapshot,
  type BehaviorDimensionKey,
  type BehaviorExperiment,
  type BehaviorExperimentTemplate,
  type BehaviorHighlight,
  type BehaviorHypothesis,
  type EmotionalCheckinRow,
} from "@/lib/behavioral/client";

export type ResilientBehavioralEvolutionSnapshot = BehavioralEvolutionSnapshot & {
  degradedSources: string[];
};

type RowsResponse<T> = {
  data: T[] | null;
  error: { message?: string | null; code?: string | null } | null;
};

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, decimals = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

function safeDay(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10);

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
  } catch {
    return date.toISOString().slice(0, 10);
  }
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

function dimensionExtremes(assessment: BehavioralAssessment | null) {
  if (!assessment) {
    return { lowest: null as BehaviorDimensionKey | null, strongest: null as BehaviorDimensionKey | null };
  }

  const ordered = BEHAVIOR_DIMENSIONS
    .map((dimension) => ({
      key: dimension.key,
      value: Number(assessment.scores?.[dimension.key] ?? 0),
    }))
    .sort((a, b) => a.value - b.value);

  return {
    lowest: ordered[0]?.key ?? null,
    strongest: ordered.at(-1)?.key ?? null,
  };
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
  return slugs
    .map((slug) => templates.find((template) => template.slug === slug))
    .filter(Boolean) as BehaviorExperimentTemplate[];
}

async function safeRows<T>(
  source: string,
  query: PromiseLike<RowsResponse<T>>,
  degraded: Set<string>,
): Promise<T[]> {
  try {
    const response = await query;
    if (response.error) {
      degraded.add(source);
      console.error(`[behavior:evolution:fallback:${source}]`, response.error);
      return [];
    }
    return response.data ?? [];
  } catch (error) {
    degraded.add(source);
    console.error(`[behavior:evolution:fallback:${source}]`, error);
    return [];
  }
}

async function loadBehavioralEvolutionFallback(userId: string): Promise<ResilientBehavioralEvolutionSnapshot> {
  const degraded = new Set<string>(["primary-loader"]);
  const from90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const fromUntyped = supabase.from as unknown as (table: string) => any;

  const [checkinsRaw, assessmentsRaw, experimentsRaw, templatesRaw, hypothesesRaw] = await Promise.all([
    safeRows<EmotionalCheckinRow>(
      "checkins",
      (supabase.from("emotional_checkins") as any)
        .select("id,occurred_at,mood,emotion_key,declared_emotion_key,trigger_label,notes,transaction_id,financial_calm_score,financial_control_score,spending_urge_score,context_key")
        .eq("user_id", userId)
        .gte("occurred_at", from90)
        .order("occurred_at", { ascending: false })
        .limit(120),
      degraded,
    ),
    safeRows<BehavioralAssessment>(
      "assessments",
      fromUntyped("behavioral_assessments")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(12),
      degraded,
    ),
    safeRows<BehaviorExperiment>(
      "experiments",
      fromUntyped("behavior_experiments")
        .select("*")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(30),
      degraded,
    ),
    safeRows<BehaviorExperimentTemplate>(
      "templates",
      fromUntyped("behavior_experiment_templates")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: true }),
      degraded,
    ),
    safeRows<BehaviorHypothesis>(
      "hypotheses",
      (supabase.from("behavior_hypotheses") as any)
        .select("id,kind,title,explanation,confidence,evidence,status,user_feedback,created_at")
        .eq("user_id", userId)
        .in("status", ["pending", "confirmed", "partial"])
        .order("updated_at", { ascending: false })
        .limit(12),
      degraded,
    ),
  ]);

  const checkins = checkinsRaw.filter((row) => {
    const valid = Number.isFinite(new Date(row.occurred_at).getTime());
    if (!valid) degraded.add("invalid-checkin-date");
    return valid;
  });

  const assessments = assessmentsRaw.map((row) => ({
    ...row,
    overall_score: Number(row.overall_score),
  }));
  const experiments = experimentsRaw.map(normalizeExperiment);
  const templates = templatesRaw.map((row) => ({
    ...row,
    target_value: Number(row.target_value),
    duration_days: Number(row.duration_days),
    xp_reward: Number(row.xp_reward),
  }));
  const hypotheses = hypothesesRaw.map((row) => ({
    ...row,
    confidence: Number(row.confidence),
  }));

  const latestAssessment = assessments[0] ?? null;
  const previousAssessment = assessments[1] ?? null;
  const overallDelta = latestAssessment && previousAssessment
    ? round(latestAssessment.overall_score - previousAssessment.overall_score)
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
  const cutoff14 = now - 14 * 86_400_000;
  const cutoff28 = now - 28 * 86_400_000;
  const cutoff30 = now - 30 * 86_400_000;
  const last30 = checkins.filter((row) => new Date(row.occurred_at).getTime() >= cutoff30);
  const recent14 = checkins
    .filter((row) => new Date(row.occurred_at).getTime() >= cutoff14)
    .map(emotionalScore);
  const previous14 = checkins
    .filter((row) => {
      const time = new Date(row.occurred_at).getTime();
      return time >= cutoff28 && time < cutoff14;
    })
    .map(emotionalScore);

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
    highlights.push({
      id: `hypothesis-${hypothesis.id}`,
      tone: "neutral",
      title: hypothesis.title,
      body: hypothesis.explanation,
      evidence: hypothesis.evidence,
    });
  }

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
    momentSignal,
    degradedSources: [...degraded],
  };
}

export async function loadBehavioralEvolutionResilient(userId: string): Promise<ResilientBehavioralEvolutionSnapshot> {
  try {
    const snapshot = await loadBehavioralEvolution(userId);
    return { ...snapshot, degradedSources: [] };
  } catch (error) {
    console.error("[behavior:evolution:primary]", error);
    return loadBehavioralEvolutionFallback(userId);
  }
}
