import { emotionalScore, type BehaviorDimensionKey, type EmotionalCheckinRow } from "@/lib/behavioral/client";
import type { ObservedBehaviorProfile, ObservedDimension } from "@/lib/behavioral/mapCycle";

const DAY_MS = 86_400_000;
export const OBSERVED_METHODOLOGY_VERSION = "behavior_observed.v2";

type FinancialRow = {
  payload?: Record<string, unknown> | null;
  as_of_date?: string | null;
  computed_at?: string | null;
  available_balance?: number | null;
};

export type BehavioralTransactionStats = {
  count?: number;
  categorized?: number;
  active_days?: number;
  first_at?: string | null;
  last_at?: string | null;
};

export type BehavioralAppActivityStats = {
  active_days_30?: number;
  total_views_30?: number;
  financial_views_30?: number;
  movement_views_30?: number;
  planning_views_30?: number;
  first_day?: string | null;
  last_day?: string | null;
};

export type BehavioralGoalCycle = {
  start_date?: string | null;
  end_date?: string | null;
  target_snapshot?: number | string | null;
  actual_spend?: number | string | null;
  projected_spend?: number | string | null;
  final_status?: string | null;
  closed_at?: string | null;
};

export type BehavioralPlanningStats = {
  active_recurring_rules?: number;
  active_category_goals?: number;
};

export type BehavioralInvestmentStats = {
  current_value?: number | string;
  emergency_reserve_value?: number | string;
  contributions_90d?: number | string;
  contribution_days_90d?: number;
};

export type ObservedProfileV2Input = {
  financialRow: FinancialRow | null;
  checkins: EmotionalCheckinRow[];
  txStats: BehavioralTransactionStats | null;
  appActivity: BehavioralAppActivityStats | null;
  goalCycles: BehavioralGoalCycle[];
  planningStats: BehavioralPlanningStats | null;
  investmentStats: BehavioralInvestmentStats | null;
};

type Confidence = "low" | "medium" | "high";
type Component = { value: number | null; weight: number };

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

function weighted(components: Component[]): number | null {
  const available = components.filter((item) => item.value != null && Number.isFinite(item.value) && item.weight > 0) as Array<{ value: number; weight: number }>;
  if (!available.length) return null;
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
  return available.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function emptyDimension(evidence = "Ainda não há evidência suficiente."): ObservedDimension {
  return { score: null, confidence: "low", evidence, source: "insufficient_data" };
}

function scoreFromReserveMonths(months: number): number {
  if (months <= 0) return 0;
  if (months <= 0.5) return months * 4;
  if (months <= 1) return 2 + (months - 0.5) * 4;
  if (months <= 3) return 4 + (months - 1) * 1.5;
  if (months <= 6) return 7 + (months - 3);
  return 10;
}

function confidenceWeight(value: Confidence) {
  return value === "high" ? 1 : value === "medium" ? 0.75 : 0.5;
}

function historyDays(firstAt?: string | null): number {
  if (!firstAt) return 0;
  const time = new Date(firstAt).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(1, Math.floor((Date.now() - time) / DAY_MS) + 1);
}

function weeksWithCheckins(rows: EmotionalCheckinRow[], days = 35): number {
  const cutoff = Date.now() - days * DAY_MS;
  const weeks = new Set<string>();
  for (const row of rows) {
    const date = new Date(row.occurred_at);
    if (!Number.isFinite(date.getTime()) || date.getTime() < cutoff) continue;
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    weeks.add(monday.toISOString().slice(0, 10));
  }
  return weeks.size;
}

export function buildObservedProfileV2(input: ObservedProfileV2Input): ObservedBehaviorProfile {
  const { financialRow, checkins, txStats, appActivity, goalCycles, planningStats, investmentStats } = input;
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
  const directCheckins30 = checkin30.filter((row) => row.financial_calm_score != null);
  const legacyCheckins30 = checkin30.filter((row) => row.financial_calm_score == null);
  const txHistoryDays = historyDays(txStats?.first_at);
  const appDays = Number(appActivity?.active_days_30 ?? 0);

  // 1) Consciência: interesse ativo em entender o dinheiro. Categorização é apenas
  // um sinal auxiliar porque boa parte dela pode ser feita automaticamente pelo Nino.
  const awarenessAccess = appDays > 0 ? clamp((appDays / 12) * 10) : null;
  const awarenessInspection = Number(appActivity?.movement_views_30 ?? 0) > 0
    ? clamp((Number(appActivity?.movement_views_30 ?? 0) / 12) * 10)
    : null;
  const awarenessCheckins = checkin30.length > 0 ? clamp((checkin30.length / 8) * 10) : null;
  const awarenessCoverage = categoryCoverage == null ? null : categoryCoverage * 10;
  let awarenessScore = weighted([
    { value: awarenessAccess, weight: 0.45 },
    { value: awarenessInspection, weight: 0.20 },
    { value: awarenessCheckins, weight: 0.25 },
    { value: awarenessCoverage, weight: 0.10 },
  ]);
  if (appDays === 0 && awarenessScore != null) awarenessScore = Math.min(6.5, awarenessScore);
  const awarenessConfidence: Confidence = appDays >= 10 && txCount >= 30
    ? "high"
    : (appDays >= 3 || checkin30.length >= 4) && txCount >= 10 ? "medium" : "low";
  const awareness: ObservedDimension = awarenessScore == null
    ? emptyDimension("O Nino ainda precisa observar como você acompanha suas finanças no app.")
    : {
        score: round(awarenessScore),
        confidence: awarenessConfidence,
        evidence: appDays > 0
          ? `Você acompanhou o Nino em ${appDays} dia${appDays === 1 ? "" : "s"} nos últimos 30 dias, abriu Movimentos ${Number(appActivity?.movement_views_30 ?? 0)} vez${Number(appActivity?.movement_views_30 ?? 0) === 1 ? "" : "es"} e fez ${checkin30.length} check-in${checkin30.length === 1 ? "" : "s"}.`
          : `O rastreamento de uso começou agora; por enquanto o Nino usa ${checkin30.length} check-in${checkin30.length === 1 ? "" : "s"} e cobertura dos lançamentos apenas como sinais provisórios.`,
        source: "app_activity+checkins+transaction_coverage",
      };

  // 2) Planejamento: comportamento de antecipar, estruturar e definir antes do gasto.
  const activeGoals = Number(planningStats?.active_category_goals ?? goals.length ?? 0);
  const recurringRules = Number(planningStats?.active_recurring_rules ?? 0);
  const planningViews = Number(appActivity?.planning_views_30 ?? 0);
  const planningComponents: Component[] = [
    { value: activeGoals > 0 ? clamp((activeGoals / 3) * 10) : null, weight: 0.45 },
    { value: recurringRules > 0 ? clamp((recurringRules / 3) * 10) : null, weight: 0.30 },
    { value: planningViews > 0 ? clamp((planningViews / 6) * 10) : null, weight: 0.25 },
  ];
  const planningSources = planningComponents.filter((item) => item.value != null).length;
  let planningScore = weighted(planningComponents);
  if (planningScore != null) planningScore = Math.min(planningSources === 1 ? 6 : planningSources === 2 ? 8 : 10, planningScore);
  const planning: ObservedDimension = planningScore == null
    ? emptyDimension("Ainda não há sinais suficientes de metas, compromissos ou planejamento antecipado.")
    : {
        score: round(planningScore),
        confidence: planningSources >= 3 && txHistoryDays >= 21 ? "high" : planningSources >= 2 ? "medium" : "low",
        evidence: `${activeGoals} meta${activeGoals === 1 ? "" : "s"} de redução ativa${activeGoals === 1 ? "" : "s"}, ${recurringRules} compromisso${recurringRules === 1 ? "" : "s"} recorrente${recurringRules === 1 ? "" : "s"} estruturado${recurringRules === 1 ? "" : "s"}${planningViews > 0 ? ` e ${planningViews} acesso${planningViews === 1 ? "" : "s"} a superfícies de planejamento` : ""}.`,
        source: "goals+recurring_rules+planning_activity",
      };

  // 3) Controle: resultado contra limites escolhidos. Ciclos fechados pesam mais;
  // metas atuais entram como evidência provisória e ritmo apenas complementa.
  const closedCycles = goalCycles.filter((cycle) => cycle.closed_at || cycle.final_status);
  const hitCycles = closedCycles.filter((cycle) => {
    const actual = Number(cycle.actual_spend);
    const target = Number(cycle.target_snapshot);
    return Number.isFinite(actual) && Number.isFinite(target) && target > 0 && actual <= target;
  });
  const cycleHitRate = closedCycles.length ? hitCycles.length / closedCycles.length : null;
  const cycleOvershoot = closedCycles.length
    ? avg(closedCycles.map((cycle) => {
        const actual = Number(cycle.actual_spend);
        const target = Number(cycle.target_snapshot);
        return Number.isFinite(actual) && Number.isFinite(target) && target > 0 ? Math.max(0, actual / target - 1) : 0;
      }))
    : null;
  const goalsOnTrack = goals.length
    ? goals.filter((goal: any) => ["on_track", "achieved"].includes(String(goal?.status))).length / goals.length
    : null;
  const goalCycleScore = cycleHitRate == null ? null : clamp(cycleHitRate * 10 - Math.min(4, (cycleOvershoot ?? 0) * 10));
  const currentGoalScore = goalsOnTrack == null ? null : goalsOnTrack * 10;
  const avgDelta = Number(snapshot?.averageDailyVariationPct);
  const rhythmControl = Number.isFinite(avgDelta) ? clamp(5 - avgDelta / 12) : null;
  let controlScore = weighted([
    { value: goalCycleScore, weight: 0.55 },
    { value: currentGoalScore, weight: 0.30 },
    { value: rhythmControl, weight: 0.15 },
  ]);
  if (!closedCycles.length && controlScore != null) controlScore = Math.min(7, controlScore);
  const control: ObservedDimension = controlScore == null
    ? emptyDimension("O Nino precisa acompanhar pelo menos uma meta ou período comparável para medir controle.")
    : {
        score: round(controlScore),
        confidence: closedCycles.length >= 3 ? "high" : closedCycles.length >= 1 || goals.length >= 2 ? "medium" : "low",
        evidence: closedCycles.length
          ? `${hitCycles.length} de ${closedCycles.length} ciclo${closedCycles.length === 1 ? "" : "s"} de meta terminou${closedCycles.length === 1 ? "" : "aram"} dentro do limite; metas atuais entram apenas como complemento.`
          : `${goals.filter((goal: any) => ["on_track", "achieved"].includes(String(goal?.status))).length} de ${goals.length} meta${goals.length === 1 ? "" : "s"} atual${goals.length === 1 ? "" : "is"} está${goals.length === 1 ? "" : "o"} no ritmo. Ainda não há ciclo fechado, então a confiança é menor.`,
        source: "goal_cycles+current_goals+spending_rhythm",
      };

  // 4) Consistência: estabilidade do comportamento, não apenas valor gasto.
  const typicalValues = Array.isArray(current?.series)
    ? current.series.map((row: any) => Number(row?.typicalAmount)).filter((value: number) => Number.isFinite(value) && value > 0)
    : [];
  const typicalMean = avg(typicalValues);
  const variance = typicalMean && typicalValues.length >= 7
    ? typicalValues.reduce((sum: number, value: number) => sum + (value - typicalMean) ** 2, 0) / typicalValues.length
    : null;
  const cv = variance != null && typicalMean ? Math.sqrt(variance) / typicalMean : null;
  const rhythmConsistency = cv == null ? null : clamp(10 - cv * 5);
  const checkinWeeks = weeksWithCheckins(checkins);
  const checkinConsistency = checkinWeeks > 0 ? clamp((checkinWeeks / 5) * 10) : null;
  const activityConsistency = appDays > 0 ? clamp((appDays / 12) * 10) : null;
  let consistencyScore = weighted([
    { value: rhythmConsistency, weight: 0.55 },
    { value: checkinConsistency, weight: 0.25 },
    { value: activityConsistency, weight: 0.20 },
  ]);
  const consistencySources = [rhythmConsistency, checkinConsistency, activityConsistency].filter((value) => value != null).length;
  if (consistencyScore != null && consistencySources === 1) consistencyScore = Math.min(6.5, consistencyScore);
  const consistency: ObservedDimension = consistencyScore == null
    ? emptyDimension("Ainda não há semanas suficientes para observar repetição de hábitos.")
    : {
        score: round(consistencyScore),
        confidence: typicalValues.length >= 14 && checkinWeeks >= 3 ? "high" : consistencySources >= 2 ? "medium" : "low",
        evidence: `O Nino observou ${typicalValues.length} dia${typicalValues.length === 1 ? "" : "s"} com ritmo típico e check-ins em ${checkinWeeks} semana${checkinWeeks === 1 ? "" : "s"} recente${checkinWeeks === 1 ? "" : "s"}.`,
        source: "rhythm_stability+checkin_regularidade+app_activity",
      };

  // 5) Segurança: reserva líquida / despesas + caixa futuro + peso das dívidas.
  const expense = Number(snapshot?.monthlyTotals?.expense ?? 0);
  const free = Number(projection?.freeAfterKnownCommitments ?? 0);
  const projectedEnd = Number(projection?.projectedEndBalance ?? 0);
  const available = Math.max(0, Number(snapshot?.availableToday ?? financialRow?.available_balance ?? 0));
  const assets = Number(netWorth?.assets ?? 0);
  const debts = Number(netWorth?.owed ?? 0);
  const emergencyReserve = Math.max(0, Number(investmentStats?.emergency_reserve_value ?? 0));
  const liquidBuffer = available + emergencyReserve;
  const reserveMonths = expense > 0 ? liquidBuffer / expense : null;
  const reserveScore = reserveMonths == null ? null : scoreFromReserveMonths(reserveMonths);
  const freeRatio = expense > 0 ? free / expense : null;
  const freeScore = freeRatio == null ? null : clamp(5 + freeRatio * 5);
  const debtAssetRatio = assets > 0 ? debts / assets : null;
  const debtBufferScore = debtAssetRatio == null ? null : clamp(10 - debtAssetRatio * 6);
  const projectionScore = Number.isFinite(projectedEnd) ? (projectedEnd > 0 ? 8 : projectedEnd === 0 ? 5 : 2) : null;
  const securityScore = weighted([
    { value: reserveScore, weight: 0.40 },
    { value: freeScore, weight: 0.25 },
    { value: debtBufferScore, weight: 0.20 },
    { value: projectionScore, weight: 0.15 },
  ]);
  const security: ObservedDimension = securityScore == null
    ? emptyDimension("Ainda não há dados suficientes para medir sua margem de segurança.")
    : {
        score: round(securityScore),
        confidence: emergencyReserve > 0 && txHistoryDays >= 30 ? "high" : expense > 0 ? "medium" : "low",
        evidence: reserveMonths == null
          ? "Ainda não foi possível estimar quantos meses de despesas sua reserva cobre."
          : emergencyReserve > 0
            ? `Caixa disponível + investimentos marcados como reserva cobrem cerca de ${reserveMonths.toFixed(1)} mês${reserveMonths >= 1.95 || reserveMonths < 0.95 ? "es" : ""} das despesas atuais.`
            : `O caixa disponível cobre cerca de ${reserveMonths.toFixed(1)} mês${reserveMonths >= 1.95 || reserveMonths < 0.95 ? "es" : ""}; nenhum investimento foi marcado explicitamente como reserva de emergência, então a leitura ainda é parcial.`,
        source: "liquid_reserve+projection+debt_burden",
      };

  // 6) Patrimônio: recorrência de aportes pesa mais que uma boa fotografia mensal.
  const contributions90 = Math.max(0, Number(investmentStats?.contributions_90d ?? 0));
  const contributionDays90 = Math.max(0, Number(investmentStats?.contribution_days_90d ?? 0));
  const currentInvestmentValue = Math.max(0, Number(investmentStats?.current_value ?? 0));
  const income = Math.max(0, Number(snapshot?.monthlyTotals?.income ?? 0));
  const savingsRate = Number(performance?.savingsRate);
  const contributionRegularity = contributionDays90 > 0 ? clamp((contributionDays90 / 6) * 10) : null;
  const contributionRate = contributions90 > 0 && income > 0 ? clamp((contributions90 / (income * 3)) * 50) : null;
  const currentSavings = Number.isFinite(savingsRate) ? clamp(5 + savingsRate * 12.5) : null;
  const net = Number(netWorth?.net ?? 0);
  let wealthScore = weighted([
    { value: contributionRegularity, weight: 0.45 },
    { value: contributionRate, weight: 0.30 },
    { value: currentSavings, weight: 0.20 },
    { value: currentInvestmentValue > 0 || net > 0 ? 7 : null, weight: 0.05 },
  ]);
  if (contributionDays90 === 0 && wealthScore != null) wealthScore = Math.min(6, wealthScore);
  const wealth: ObservedDimension = wealthScore == null
    ? emptyDimension("O Nino ainda não tem histórico suficiente de aportes para medir construção de patrimônio.")
    : {
        score: round(wealthScore),
        confidence: contributionDays90 >= 4 ? "high" : contributionDays90 >= 2 ? "medium" : "low",
        evidence: contributionDays90 > 0
          ? `Foram observados aportes em ${contributionDays90} dia${contributionDays90 === 1 ? "" : "s"} nos últimos 90 dias, somando R$ ${contributions90.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}.`
          : `Há patrimônio/investimentos registrados, mas ainda não há recorrência de aportes suficiente; a taxa de poupança do mês não é tratada como hábito por si só.`,
        source: "investment_contributions+current_savings+net_worth",
      };

  // 7) Tranquilidade: declaração direta tem prioridade. Histórico legado é útil,
  // mas entra como estimativa de menor confiança e nunca finge ser a nova escala.
  const directValues = directCheckins30.map((row) => Number(row.financial_calm_score)).filter(Number.isFinite);
  const legacyValues = legacyCheckins30.map(emotionalScore).filter(Number.isFinite);
  const directAvg = avg(directValues);
  const legacyAvg = avg(legacyValues);
  const calmScore = directAvg != null
    ? directValues.length >= 3 ? directAvg : weighted([{ value: directAvg, weight: 0.7 }, { value: legacyAvg, weight: 0.3 }])
    : legacyAvg;
  const calm: ObservedDimension = calmScore == null
    ? emptyDimension("Faça alguns check-ins para o Nino observar sua tranquilidade ao longo do tempo.")
    : {
        score: round(calmScore),
        confidence: directValues.length >= 10 ? "high" : directValues.length >= 4 ? "medium" : "low",
        evidence: `${directValues.length} check-in${directValues.length === 1 ? "" : "s"} mediu${directValues.length === 1 ? "" : "ram"} tranquilidade diretamente nos últimos 30 dias${legacyValues.length ? `; ${legacyValues.length} registro${legacyValues.length === 1 ? "" : "s"} antigo${legacyValues.length === 1 ? "" : "s"} entra${legacyValues.length === 1 ? "" : "m"} apenas como contexto estimado` : ""}.`,
        source: "direct_financial_calm+legacy_context",
      };

  // 8) Dívidas: trajetória de principal + peso sobre ativos.
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
        confidence: openingDebts > 0 && txHistoryDays >= 20 ? "high" : "medium",
        evidence: closingDebts === 0
          ? "Não há dívida financeira ativa registrada no snapshot atual."
          : `O Nino compara a trajetória do saldo devedor com o peso da dívida sobre os ativos; uma dívida controlada não é penalizada apenas por existir.`,
        source: "debt_trajectory+debt_burden",
      };

  const dimensions: Record<BehaviorDimensionKey, ObservedDimension> = {
    awareness, planning, control, consistency, security, wealth, calm, debt,
  };
  const scored = Object.values(dimensions).filter((row) => row.score != null) as Array<ObservedDimension & { score: number }>;
  const overallScore = scored.length
    ? scored.reduce((sum, row) => sum + row.score * confidenceWeight(row.confidence), 0)
      / scored.reduce((sum, row) => sum + confidenceWeight(row.confidence), 0)
    : null;
  const confidenceAverage = scored.length
    ? scored.reduce((sum, row) => sum + confidenceWeight(row.confidence), 0) / scored.length
    : 0;
  const profileConfidence: Confidence = scored.length >= 6 && txHistoryDays >= 30 && confidenceAverage >= 0.82
    ? "high"
    : scored.length >= 4 && confidenceAverage >= 0.62 ? "medium" : "low";

  return {
    overallScore: round(overallScore),
    coverage: scored.length,
    asOf: financialRow?.as_of_date ?? null,
    dimensions,
    methodologyVersion: OBSERVED_METHODOLOGY_VERSION,
    overallConfidence: profileConfidence,
    historyDays: txHistoryDays,
  } as ObservedBehaviorProfile;
}
