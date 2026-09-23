import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/db/pagedSelect";
import { shift, today } from "@/lib/engine/ninoClock";
import {
  emotionalScore,
  type BehavioralAssessment,
  type BehaviorDimensionKey,
  type EmotionalCheckinRow,
} from "@/lib/behavioral/client";

export const BEHAVIOR_MAP_CADENCE_DAYS = 15;

export type ExtendedBehavioralAssessment = BehavioralAssessment & {
  observed_scores?: Partial<Record<BehaviorDimensionKey, number>> | null;
  observed_overall_score?: number | null;
  observed_coverage?: number | null;
  observed_evidence?: Partial<Record<BehaviorDimensionKey, string>> | null;
  question_set?: string | null;
  next_due_at?: string | null;
};

export type ObservedDimension = {
  score: number | null;
  confidence: "low" | "medium" | "high";
  evidence: string;
  source: string;
};

export type ObservedBehaviorProfile = {
  overallScore: number | null;
  coverage: number;
  asOf: string | null;
  dimensions: Record<BehaviorDimensionKey, ObservedDimension>;
};

export type AssessmentCycle = {
  cadenceDays: number;
  due: boolean;
  nextDueAt: string | null;
  daysRemaining: number | null;
  questionSetIndex: number;
  questionSet: "wheel_set_a" | "wheel_set_b" | "wheel_set_c";
};

export type BehavioralMapState = {
  assessments: ExtendedBehavioralAssessment[];
  latestAssessment: ExtendedBehavioralAssessment | null;
  previousAssessment: ExtendedBehavioralAssessment | null;
  overallDelta: number | null;
  checkins: EmotionalCheckinRow[];
  moodHistory: Array<{ day: string; score: number; control: number | null; urge: number | null; emotion: string | null }>;
  moodAverage30: number | null;
  moodTrend14: number | null;
  observed: ObservedBehaviorProfile;
  cycle: AssessmentCycle;
  degradedSources: string[];
};

type FinancialRow = {
  payload?: Record<string, unknown> | null;
  as_of_date?: string | null;
  computed_at?: string | null;
  available_balance?: number | null;
};

type TxRow = {
  id: string;
  amount: number;
  category_id?: string | null;
  occurred_at: string;
  behavioral_day?: string | null;
  movement_kind?: string | null;
};

const QUESTION_SETS: Record<BehaviorDimensionKey, [string, string, string]> = {
  awareness: [
    "Quanto você entende hoje para onde seu dinheiro vai e por que você decide gastar?",
    "Se alguém te perguntasse hoje o que mais pressiona seu mês, quão claramente você conseguiria responder?",
    "Quanto você percebe os gatilhos e padrões por trás das suas decisões financeiras antes de olhar o extrato?",
  ],
  planning: [
    "Quanto suas decisões financeiras costumam acontecer antes, e não depois do gasto?",
    "Quanto você sente que antecipa contas, compras e compromissos antes que eles virem urgência?",
    "Quanto do seu mês financeiro parece intencional em vez de simplesmente acontecer?",
  ],
  control: [
    "Quanto você sente que consegue escolher antes de agir quando surge vontade de gastar?",
    "Quando aparece uma compra não planejada, quanto você consegue criar espaço entre vontade e decisão?",
    "Quanto suas compras refletem escolhas conscientes, mesmo quando algo desperta desejo imediato?",
  ],
  consistency: [
    "Quanto seus bons hábitos financeiros sobrevivem às semanas mais corridas?",
    "Quanto você consegue repetir boas decisões financeiras sem depender de estar especialmente motivado?",
    "Quanto sua organização financeira continua funcionando quando sua rotina muda ou fica mais puxada?",
  ],
  security: [
    "Quanto você sente que consegue absorver imprevistos sem perder o controle do mês?",
    "Se aparecesse um gasto inesperado hoje, quanto você sentiria que seu mês ainda está protegido?",
    "Quanto sua situação atual te dá margem para lidar com imprevistos sem recorrer a novas dívidas?",
  ],
  wealth: [
    "Quanto você está transformando renda em patrimônio de forma recorrente?",
    "Quanto das suas decisões atuais estão construindo o seu futuro financeiro, e não apenas pagando o presente?",
    "Quanto você sente que consegue reservar recursos para patrimônio de maneira consistente?",
  ],
  calm: [
    "Quanto o dinheiro ocupa sua cabeça de forma tranquila, sem pressão desnecessária?",
    "Quando pensa na sua vida financeira hoje, quanta tranquilidade aparece antes da preocupação?",
    "Quanto você sente que consegue olhar para seus números sem evitar, acelerar ou se cobrar demais?",
  ],
  debt: [
    "Quanto você sente que suas dívidas e compromissos estão sob controle?",
    "Quanto você entende o caminho para reduzir suas dívidas e sente que ele cabe no seu mês?",
    "Quanto seus compromissos financeiros parecem previsíveis e administráveis hoje?",
  ],
};

export function behaviorQuestionForDimension(key: BehaviorDimensionKey, setIndex: number): string {
  const set = QUESTION_SETS[key];
  return set[((setIndex % set.length) + set.length) % set.length];
}

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

function emptyDimension(evidence = "Ainda não há evidência suficiente."): ObservedDimension {
  return { score: null, confidence: "low", evidence, source: "insufficient_data" };
}

function confidenceBySample(sample: number, medium = 10, high = 30): "low" | "medium" | "high" {
  if (sample >= high) return "high";
  if (sample >= medium) return "medium";
  return "low";
}

function buildObservedProfile(financialRow: FinancialRow | null, checkins: EmotionalCheckinRow[], txRows: TxRow[]): ObservedBehaviorProfile {
  const payload = (financialRow?.payload ?? {}) as any;
  const snapshot = payload?.snapshot ?? {};
  const rhythm = snapshot?.rhythm ?? {};
  const current = rhythm?.current ?? {};
  const projection = snapshot?.projection ?? {};
  const netWorth = snapshot?.netWorth ?? {};
  const netWorthBridge = snapshot?.netWorthBridge ?? {};
  const performance = snapshot?.periodPerformance ?? {};
  const goals = Array.isArray(snapshot?.activeCategoryGoals) ? snapshot.activeCategoryGoals : [];

  const confirmedTx = txRows.filter((row) => (row.movement_kind ?? "transaction") === "transaction");
  const categorized = confirmedTx.filter((row) => Boolean(row.category_id)).length;
  const categoryCoverage = confirmedTx.length ? categorized / confirmedTx.length : null;
  const checkin30 = checkins.filter((row) => Date.now() - new Date(row.occurred_at).getTime() <= 30 * 86_400_000);

  const awareness = categoryCoverage == null
    ? emptyDimension("O Nino precisa de mais lançamentos confirmados para observar esta dimensão.")
    : {
        score: round(clamp((categoryCoverage * 0.7 + Math.min(1, checkin30.length / 10) * 0.3) * 10)),
        confidence: confidenceBySample(confirmedTx.length, 15, 50),
        evidence: `${Math.round(categoryCoverage * 100)}% dos gastos recentes estão categorizados e houve ${checkin30.length} check-in${checkin30.length === 1 ? "" : "s"} em 30 dias.`,
        source: "transactions+checkins",
      } satisfies ObservedDimension;

  const projectionConfidence = projection?.confidence === "high" ? 1 : projection?.confidence === "medium" ? 0.75 : projection?.confidence ? 0.5 : null;
  const goalsOnTrack = goals.length
    ? goals.filter((goal: any) => ["on_track", "achieved"].includes(String(goal?.status))).length / goals.length
    : null;
  const planningScore = projectionConfidence == null && goalsOnTrack == null
    ? null
    : clamp(((projectionConfidence ?? 0.6) * 4) + ((goalsOnTrack ?? 0.6) * 6));
  const planning: ObservedDimension = planningScore == null
    ? emptyDimension("Ainda faltam compromissos/metas suficientes para observar seu planejamento.")
    : {
        score: round(planningScore),
        confidence: goals.length >= 2 && projectionConfidence != null ? "high" : "medium",
        evidence: goals.length
          ? `${goals.filter((goal: any) => ["on_track", "achieved"].includes(String(goal?.status))).length} de ${goals.length} metas de categoria estão no ritmo, com projeção ${String(projection?.confidence ?? "parcial")}.`
          : `A projeção financeira está com confiança ${String(projection?.confidence ?? "parcial")} e compromissos futuros estão mapeados.`,
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
          ? `Seu gasto médio diário está ${Math.abs(avgDelta).toFixed(0)}% ${avgDelta <= 0 ? "abaixo" : "acima"} do período comparável${goals.length ? `; ${Math.round((goalsOnTrack ?? 0) * 100)}% das metas estão no ritmo` : ""}.`
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
    awareness,
    planning,
    control,
    consistency,
    security,
    wealth,
    calm,
    debt,
  };
  const scored = Object.values(dimensions).map((row) => row.score).filter((value): value is number => value != null);

  return {
    overallScore: round(avg(scored)),
    coverage: scored.length,
    asOf: financialRow?.as_of_date ?? null,
    dimensions,
  };
}

function assessmentCycle(assessments: ExtendedBehavioralAssessment[]): AssessmentCycle {
  const latest = assessments[0] ?? null;
  const nextDueAt = latest?.next_due_at
    ?? (latest ? new Date(new Date(latest.created_at).getTime() + BEHAVIOR_MAP_CADENCE_DAYS * 86_400_000).toISOString() : null);
  const msRemaining = nextDueAt ? new Date(nextDueAt).getTime() - Date.now() : null;
  const daysRemaining = msRemaining == null ? null : Math.max(0, Math.ceil(msRemaining / 86_400_000));
  const questionSetIndex = assessments.length % 3;
  const questionSet = (["wheel_set_a", "wheel_set_b", "wheel_set_c"] as const)[questionSetIndex];
  return {
    cadenceDays: BEHAVIOR_MAP_CADENCE_DAYS,
    due: !latest || (msRemaining != null && msRemaining <= 0),
    nextDueAt,
    daysRemaining,
    questionSetIndex,
    questionSet,
  };
}

function emptyObserved(): ObservedBehaviorProfile {
  const dimensions = Object.fromEntries([
    "awareness", "planning", "control", "consistency", "security", "wealth", "calm", "debt",
  ].map((key) => [key, emptyDimension()])) as Record<BehaviorDimensionKey, ObservedDimension>;
  return { overallScore: null, coverage: 0, asOf: null, dimensions };
}

export async function loadBehavioralMapState(userId: string): Promise<BehavioralMapState> {
  const degraded = new Set<string>();
  const from180 = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const from90Day = shift(today(), -90);
  const fromUntyped = supabase.from as unknown as (table: string) => any;

  const txPromise = fetchAllPages<TxRow>((from, to) => supabase.from("transactions")
    .select("id,amount,category_id,occurred_at,behavioral_day,movement_kind")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .eq("type", "expense")
    .gte("occurred_at", from90Day)
    .order("occurred_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to) as any, { source: "behavioral_map_transactions" })
    .catch((error) => {
      degraded.add("transactions");
      console.error("[behavior:map:transactions]", error);
      return [] as TxRow[];
    });

  const [checkinResult, assessmentResult, financialResult, txRows] = await Promise.all([
    (supabase.from("emotional_checkins") as any)
      .select("id,occurred_at,mood,emotion_key,declared_emotion_key,trigger_label,notes,transaction_id,financial_calm_score,financial_control_score,spending_urge_score,context_key")
      .eq("user_id", userId)
      .gte("occurred_at", from180)
      .order("occurred_at", { ascending: false })
      .limit(240),
    fromUntyped("behavioral_assessments")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(24),
    fromUntyped("financial_current_snapshots")
      .select("payload,as_of_date,computed_at,available_balance")
      .eq("user_id", userId)
      .maybeSingle(),
    txPromise,
  ]);

  const checkins = checkinResult.error
    ? (degraded.add("checkins"), console.error("[behavior:map:checkins]", checkinResult.error), [] as EmotionalCheckinRow[])
    : ((checkinResult.data ?? []) as EmotionalCheckinRow[]);
  const assessments = assessmentResult.error
    ? (degraded.add("assessments"), console.error("[behavior:map:assessments]", assessmentResult.error), [] as ExtendedBehavioralAssessment[])
    : ((assessmentResult.data ?? []) as ExtendedBehavioralAssessment[]).map((row) => ({
        ...row,
        overall_score: Number(row.overall_score),
        observed_overall_score: row.observed_overall_score == null ? null : Number(row.observed_overall_score),
        observed_coverage: row.observed_coverage == null ? null : Number(row.observed_coverage),
      }));
  const financialRow = financialResult.error
    ? (degraded.add("financial_snapshot"), console.error("[behavior:map:financial]", financialResult.error), null)
    : ((financialResult.data ?? null) as FinancialRow | null);

  const orderedMood = [...checkins].reverse().map((row) => ({
    day: safeDay(row.occurred_at),
    score: emotionalScore(row),
    control: row.financial_control_score == null ? null : Number(row.financial_control_score),
    urge: row.spending_urge_score == null ? null : Number(row.spending_urge_score),
    emotion: row.declared_emotion_key ?? row.emotion_key ?? row.trigger_label ?? null,
  }));
  const cutoff30 = Date.now() - 30 * 86_400_000;
  const cutoff14 = Date.now() - 14 * 86_400_000;
  const cutoff28 = Date.now() - 28 * 86_400_000;
  const last30 = checkins.filter((row) => new Date(row.occurred_at).getTime() >= cutoff30);
  const recent14 = checkins.filter((row) => new Date(row.occurred_at).getTime() >= cutoff14).map(emotionalScore);
  const previous14 = checkins.filter((row) => {
    const time = new Date(row.occurred_at).getTime();
    return time >= cutoff28 && time < cutoff14;
  }).map(emotionalScore);
  const recentAvg = avg(recent14);
  const previousAvg = avg(previous14);
  const latestAssessment = assessments[0] ?? null;
  const previousAssessment = assessments[1] ?? null;

  return {
    assessments,
    latestAssessment,
    previousAssessment,
    overallDelta: latestAssessment && previousAssessment
      ? round(Number(latestAssessment.overall_score) - Number(previousAssessment.overall_score))
      : null,
    checkins,
    moodHistory: orderedMood,
    moodAverage30: round(avg(last30.map(emotionalScore))),
    moodTrend14: recentAvg != null && previousAvg != null ? round(recentAvg - previousAvg) : null,
    observed: financialRow || checkins.length || txRows.length
      ? buildObservedProfile(financialRow, checkins, txRows)
      : emptyObserved(),
    cycle: assessmentCycle(assessments),
    degradedSources: [...degraded],
  };
}

export async function saveBehavioralAssessmentV2(
  scores: Record<BehaviorDimensionKey, number>,
  observed: ObservedBehaviorProfile,
  questionSet: string,
) {
  const observedScores = Object.fromEntries(
    Object.entries(observed.dimensions)
      .filter(([, value]) => value.score != null)
      .map(([key, value]) => [key, value.score]),
  );
  const observedEvidence = Object.fromEntries(
    Object.entries(observed.dimensions)
      .filter(([, value]) => value.score != null)
      .map(([key, value]) => [key, value.evidence]),
  );

  const { data, error } = await (supabase.rpc as any)("behavioral_assessment_save_v2", {
    p_scores: scores,
    p_observed_scores: observedScores,
    p_observed_overall: observed.overallScore,
    p_observed_coverage: observed.coverage,
    p_observed_evidence: observedEvidence,
    p_question_set: questionSet,
  });
  if (error) throw error;
  return data as ExtendedBehavioralAssessment;
}
