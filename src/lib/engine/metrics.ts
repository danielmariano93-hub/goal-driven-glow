// FinancialMetricsService (frontend). Núcleo puro que compõe helpers existentes
// e adiciona metas de categoria. Consumido por `useFinancialSnapshot` e por
// componentes da Home. Não faz I/O — só cálculo determinístico.
import {
  computeAvailableUntil,
  computeBehavioralExpense,
  computeNetWorth,
  computeTotalCash,
  computeActiveDebtsTotal,
  computeCategoryBreakdown,
  computeGoalProgressFacts,
  computeInvestmentsTotal,
  computeInvestedPrincipal,
  computeMonthlyTotals,
  computeUpcomingCommitments,
  isRealMonthlyMovement,
  round2,
  todayISO,
  type AccountRow,
  type AccountBalanceSnapshotRow,
  type CategoryRow,
  type DebtRow,
  type GoalContributionRow,
  type GoalRow,
  type InvestmentRow,
  type RecurringRow,
  type TransactionRow,
} from "./facts";
import {
  computeCardExposure,
  totalCardDebtOf,
  totalFutureInstallmentsOf,
  type CardExposure,
  type CardInstallmentRow,
  type CardStatementRow,
} from "./cardExposure";
import { computeCardSpendingComparison, daysInclusive, type DateRange } from "./dailyAverage";
import {
  clampRangeToToday,
  computeRhythmComparison,
  type RhythmComparison,
  type RhythmTx,
} from "./spendingRhythm";

export type CategoryGoalMode = "percent_reduction" | "fixed_limit";
export type CategoryGoalBaselineKind = "prev_month" | "avg_3m" | "custom";
export type CategoryGoalPeriodType =
  | "this_month"
  | "next_month"
  | "next_30_days"
  | "custom"
  | "monthly_recurring";

/**
 * Status priorizado (ordem de precedência descendente):
 *   paused/cancelled > scheduled > exceeded > limit_reached >
 *   completed_ok/completed_over > at_risk > attention > on_track
 * Uma meta cuja soma real já ultrapassou o limite jamais pode aparecer como
 * "on_track" ou "attention".
 */
export type CategoryGoalStatus =
  | "on_track"
  | "attention"
  | "at_risk"
  | "exceeded"
  | "scheduled"
  | "limit_reached"
  | "completed_ok"
  | "completed_over"
  | "paused"
  | "cancelled";

export interface CategorySpendingGoalRow {
  id: string;
  user_id: string;
  category_id: string;
  mode: CategoryGoalMode;
  reduction_pct: number | null;
  fixed_limit: number | null;
  baseline_kind: CategoryGoalBaselineKind;
  baseline_value: number | null;
  computed_limit: number;
  frequency: "once" | "monthly" | "custom";
  start_date: string;
  end_date: string | null;
  status: "active" | "paused" | "cancelled";
  period_type?: CategoryGoalPeriodType;
  recurrence_end_date?: string | null;
  timezone?: string;
  alerts?: unknown;
}

export interface CategoryGoalEvaluation {
  goal: CategorySpendingGoalRow;
  period: DateRange;
  periodType: CategoryGoalPeriodType;
  categoryName?: string;

  // Contrato oficial (nomes canônicos)
  baselineAmount: number;
  targetAmount: number;
  actualSpend: number;
  remainingAmount: number;
  percentageUsed: number; // 0..1 (utilização real, sem clamp)
  elapsedDays: number;
  totalDays: number;
  remainingDays: number;
  currentDailyRate: number;
  projectedFinalSpend: number;
  projectedDifference: number; // target - projected
  projectedOverage: number; // max(0, projected - target)
  currentOverage: number; // max(0, actual - target)
  dailyAllowance: number;
  requiredDailyReduction: number;
  status: CategoryGoalStatus;
  message: string;
  calculationReferenceDate: string;
  includedTransactionCount: number;
  projectionMethod: "linear" | "weekday_weighted";

  // Aliases legados (mantidos para não quebrar consumidores existentes)
  spent: number;
  limit: number;
  utilizationPct: number; // clampado 0..1 para barra
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  projectedSpend: number;
  projectedOverspend: number;
}

/** Versão do contrato financeiro único (App × Edge × Nino × MCP). */
export const FINANCE_CONTRACT_VERSION = "finance_contract.v2";

export interface FinancialSnapshotInput {
  accounts: AccountRow[];
  txs: TransactionRow[];
  recurring: RecurringRow[];
  snapshots: AccountBalanceSnapshotRow[];
  investments: InvestmentRow[];
  debts: DebtRow[];
  categoryGoals: CategorySpendingGoalRow[];
  categoryNameById?: Record<string, string>;
  period: DateRange;
  today?: Date;
  /** Faturas oficiais — quando presentes, têm precedência absoluta. */
  cardStatements?: CardStatementRow[];
  cardInstallments?: CardInstallmentRow[];
  cardIds?: string[];
  /** Metas individuais + contribuições (progresso canônico no snapshot). */
  goals?: GoalRow[];
  goalContributions?: GoalContributionRow[];
  /** Categorias para o breakdown canônico do mês. */
  categories?: CategoryRow[];
}

export interface SnapshotGoalProgress {
  id: string;
  name: string;
  target: number;
  contributed: number;
  investedLinked: number;
  total: number;
  remaining: number;
  pct: number;
}

export interface FinancialSnapshot {
  contractVersion: string;
  today: string;
  period: DateRange;
  availableToday: number;
  netWorth: ReturnType<typeof computeNetWorth>;
  currentAverageDailyConsumption: number;
  previousAverageDailyConsumption: number;
  averageDailyVariationPct: number | null;
  /** Fonte canônica de ritmo (média total + ritmo típico + série acumulada). */
  rhythm: RhythmComparison;
  currentCardSpend: number;
  previousCardSpend: number;
  cardSpendVariationPct: number | null;
  daysRemainingInMonth: number;
  monthToDateAverageConsumption: number;
  projectedRemainingConsumption: number;
  confirmedFutureIncome: number;
  knownFutureCommitments: number;
  projectedMonthEndAvailable: number;
  activeCategoryGoals: CategoryGoalEvaluation[];
  topCategoryGoal: CategoryGoalEvaluation | null;
  /** Exposição de cartão por cartão (fonte canônica única). */
  cardExposures: Record<string, CardExposure>;
  /** Dívida de cartão hoje — faturas abertas/parciais/atrasadas. */
  cardDebtToday: number;
  /** Parcelas de competências futuras — compromisso, não dívida atual. */
  cardFutureInstallments: number;
  /** true quando algum número de cartão veio de estimativa (sem fatura oficial). */
  cardDebtIsEstimated: boolean;
  /** Totais comportamentais do mês corrente (mesma regra de Relatórios/MCP). */
  monthlyTotals: { month: string; income: number; expense: number; net: number };
  /** Breakdown de despesa do mês corrente por categoria. */
  categoryBreakdown: ReturnType<typeof computeCategoryBreakdown>;
  /** Saldo devedor das dívidas ativas (fora do cartão). */
  activeDebtTotal: number;
  /** Valor atual da carteira e principal aportado. */
  investmentsTotal: number;
  investedPrincipal: number;
  /** Progresso canônico das metas individuais. */
  goalProgress: SnapshotGoalProgress[];
  /** Compromissos conhecidos nos próximos 30 dias. */
  upcomingCommitments: ReturnType<typeof computeUpcomingCommitments>;
}


function monthRangeOf(d: Date): DateRange {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: todayISO(start), end: todayISO(end) };
}

/**
 * Resolve o período efetivo da meta considerando `period_type` e a data atual.
 * Para `monthly_recurring`, retorna o ciclo do mês corrente (ou próximo, se a
 * meta ainda não começou), respeitando `recurrence_end_date`.
 */
export function resolveGoalPeriod(goal: CategorySpendingGoalRow, today: Date): DateRange {
  const type: CategoryGoalPeriodType = (goal.period_type as CategoryGoalPeriodType | undefined) ??
    (goal.end_date ? "custom" : "monthly_recurring");

  const todayIso = todayISO(today);

  if (type === "monthly_recurring") {
    const anchor = new Date(Math.max(new Date(goal.start_date + "T00:00:00").getTime(), today.getTime()));
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    // Se o mês de hoje é anterior ao start_date da meta, usa o próprio mês do start.
    if (todayIso < goal.start_date) {
      const gs = new Date(goal.start_date + "T00:00:00");
      return {
        start: todayISO(new Date(gs.getFullYear(), gs.getMonth(), 1)),
        end: todayISO(new Date(gs.getFullYear(), gs.getMonth() + 1, 0)),
      };
    }
    return { start: todayISO(start), end: todayISO(end) };
  }

  // Casos com datas explícitas (this_month, next_month, next_30_days, custom):
  // usa exatamente o que veio persistido em start_date/end_date.
  return {
    start: goal.start_date,
    end: goal.end_date ?? goal.start_date,
  };
}

function statusPriority(
  goal: CategorySpendingGoalRow,
  today: Date,
  period: DateRange,
  actualSpend: number,
  limit: number,
  projected: number,
): CategoryGoalStatus {
  if (goal.status === "cancelled") return "cancelled";
  if (goal.status === "paused") return "paused";
  const todayIso = todayISO(today);
  if (todayIso < period.start) return "scheduled";
  // Prioridade absoluta: ultrapassada mata qualquer projeção
  if (actualSpend > limit) {
    return todayIso > period.end ? "completed_over" : "exceeded";
  }
  if (todayIso > period.end) return actualSpend <= limit ? "completed_ok" : "completed_over";
  if (actualSpend === limit) return "limit_reached";
  // Ainda dentro do período e abaixo do limite: olha projeção
  const overage = Math.max(0, projected - limit);
  if (overage > limit * 0.1) return "at_risk";
  if (overage > 0) return "attention";
  return "on_track";
}

function statusMessage(
  status: CategoryGoalStatus,
  name: string,
  currentOverage: number,
  projectedOverage: number,
  projected: number,
  dailyAllowance: number,
  requiredDailyReduction: number,
  daysRemaining: number,
  periodStart: string,
  periodEnd: string,
): string {
  const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  switch (status) {
    case "scheduled":
      return `Começa em ${new Date(periodStart + "T00:00:00").toLocaleDateString("pt-BR")}.`;

    case "paused":
      return `Meta de ${name} está pausada.`;
    case "cancelled":
      return `Meta de ${name} foi cancelada.`;
    case "exceeded":
      return `Você ultrapassou o limite em ${brl(currentOverage)}. Novos gastos aumentarão o excesso.`;
    case "limit_reached":
      return `Você atingiu o limite e ainda faltam ${daysRemaining} dia(s).`;
    case "completed_ok":
      return `Você encerrou o período dentro do limite em ${name}.`;
    case "completed_over":
      return `O período terminou ${brl(currentOverage)} acima da meta.`;
    case "at_risk":
      return `Para ficar dentro da meta, reduza aprox. ${brl(requiredDailyReduction)} por dia.`;
    case "attention":
      return `No ritmo atual, você pode ultrapassar a meta em ${brl(projectedOverage)}.`;
    case "on_track":
    default:
      return `No ritmo atual, você deve terminar em ${brl(projected)}.`;
  }
}

export function evaluateCategoryGoal(
  goal: CategorySpendingGoalRow,
  txs: TransactionRow[],
  today: Date,
  categoryName?: string,
): CategoryGoalEvaluation {
  const period = resolveGoalPeriod(goal, today);
  const todayIso = todayISO(today);
  const totalDays = Math.max(1, daysInclusive(period.start, period.end));

  // Data de referência: menor entre hoje e fim do período
  const referenceIso = todayIso < period.end ? todayIso : period.end;
  const elapsedDays = todayIso < period.start
    ? 0
    : Math.min(totalDays, daysInclusive(period.start, referenceIso));
  const remainingDays = todayIso < period.start
    ? totalDays
    : todayIso >= period.end
      ? 0
      : Math.max(0, totalDays - elapsedDays);

  // Soma real de despesas comportamentais da categoria no período
  let actualSpend = 0;
  let includedTransactionCount = 0;
  for (const t of txs) {
    if (t.category_id !== goal.category_id) continue;
    if (t.type !== "expense") continue;
    if (!isRealMonthlyMovement(t)) continue;
    if (t.occurred_at < period.start || t.occurred_at > period.end) continue;
    actualSpend += Number(t.amount || 0);
    includedTransactionCount += 1;
  }
  actualSpend = round2(Math.max(0, actualSpend));

  const limit = round2(Number(goal.computed_limit || 0));
  const baselineAmount = round2(Number(goal.baseline_value ?? 0));
  const remainingAmount = round2(limit - actualSpend);
  const percentageUsed = limit > 0 ? round2(actualSpend / limit) : 0;

  const currentDailyRate = elapsedDays > 0 ? round2(actualSpend / elapsedDays) : 0;

  // Projeção linear (garantindo nunca menor que o já gasto)
  const projectedLinear = elapsedDays > 0
    ? round2(actualSpend + currentDailyRate * remainingDays)
    : actualSpend;
  const projectedFinalSpend = Math.max(actualSpend, projectedLinear);
  const projectedDifference = round2(limit - projectedFinalSpend);
  const projectedOverage = round2(Math.max(0, projectedFinalSpend - limit));
  const currentOverage = round2(Math.max(0, actualSpend - limit));

  const remainingBudget = Math.max(0, limit - actualSpend);
  const dailyAllowance = actualSpend >= limit || remainingDays === 0
    ? 0
    : round2(remainingBudget / remainingDays);

  const allowedRemainingRate = remainingDays > 0 ? remainingBudget / remainingDays : 0;
  const requiredDailyReduction = projectedOverage > 0 && remainingDays > 0
    ? round2(Math.max(0, currentDailyRate - allowedRemainingRate))
    : 0;

  const status = statusPriority(goal, today, period, actualSpend, limit, projectedFinalSpend);
  const message = statusMessage(
    status,
    categoryName ?? "categoria",
    currentOverage,
    projectedOverage,
    projectedFinalSpend,
    dailyAllowance,
    requiredDailyReduction,
    remainingDays,
    period.start,
    period.end,
  );


  const utilClamped = Math.min(1, Math.max(0, percentageUsed));

  return {
    goal,
    period,
    periodType: (goal.period_type as CategoryGoalPeriodType | undefined) ?? "monthly_recurring",
    categoryName,
    baselineAmount,
    targetAmount: limit,
    actualSpend,
    remainingAmount,
    percentageUsed,
    elapsedDays,
    totalDays,
    remainingDays,
    currentDailyRate,
    projectedFinalSpend,
    projectedDifference,
    projectedOverage,
    currentOverage,
    dailyAllowance,
    requiredDailyReduction,
    status,
    message,
    calculationReferenceDate: referenceIso,
    includedTransactionCount,
    projectionMethod: "linear",
    // Aliases legados
    spent: actualSpend,
    limit,
    utilizationPct: utilClamped,
    daysElapsed: elapsedDays,
    daysTotal: totalDays,
    daysRemaining: remainingDays,
    projectedSpend: projectedFinalSpend,
    projectedOverspend: projectedOverage,
  };
}

/** Baseline de referência para propor um limite: média dos últimos 3 meses ou mês anterior. */
export function computeCategoryBaseline(
  txs: TransactionRow[],
  categoryId: string,
  kind: CategoryGoalBaselineKind,
  today: Date,
): number {
  if (kind === "custom") return 0;
  const months = kind === "avg_3m" ? 3 : 1;
  let total = 0;
  let counted = 0;
  for (let i = 1; i <= months; i++) {
    const ref = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = todayISO(new Date(ref.getFullYear(), ref.getMonth(), 1));
    const end = todayISO(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
    let monthTotal = 0;
    for (const t of txs) {
      if (t.category_id !== categoryId) continue;
      if (t.type !== "expense") continue;
      if (!isRealMonthlyMovement(t)) continue;
      if (t.occurred_at < start || t.occurred_at > end) continue;
      monthTotal += Number(t.amount || 0);
    }
    total += monthTotal;
    counted += 1;
  }
  return round2(counted > 0 ? total / counted : 0);
}

export function computeFinancialSnapshot(input: FinancialSnapshotInput): FinancialSnapshot {
  const today = input.today ?? new Date();
  const todayIso = todayISO(today);

  const availableToday = computeTotalCash(input.accounts, input.txs, input.snapshots);
  const netWorthRaw = computeNetWorth(input.accounts, input.txs, input.investments, input.debts, input.snapshots);
  const cardExposures = computeCardExposure({
    cardIds: input.cardIds ?? [],
    statements: input.cardStatements ?? [],
    installments: input.cardInstallments ?? [],
    txs: input.txs as never,
    currentYM: todayIso.slice(0, 7),
  });
  const hasCardSource = Object.keys(cardExposures).length > 0;
  const cardDebtToday = hasCardSource ? totalCardDebtOf(cardExposures) : round2(netWorthRaw.cardsOwed);
  const cardFutureInstallments = totalFutureInstallmentsOf(cardExposures);
  const cardDebtIsEstimated = Object.values(cardExposures).some((e) => e.currentStatement.source !== "official");
  // Patrimônio usa a MESMA dívida de cartão exibida na página Cartões.
  const owed = round2(netWorthRaw.accountOverdraft + cardDebtToday + netWorthRaw.otherDebts);
  const netWorth = {
    ...netWorthRaw,
    cardsOwed: cardDebtToday,
    owed,
    net: round2(netWorthRaw.assets - owed),
  };
  const effectivePeriod = clampRangeToToday(input.period, todayIso);
  const rhythm = computeRhythmComparison(input.txs as RhythmTx[], effectivePeriod, {
    categoryNameById: input.categoryNameById ?? {},
  });
  const card = computeCardSpendingComparison(input.txs, effectivePeriod);

  const monthRange = monthRangeOf(today);
  const monthToDateRange: DateRange = { start: monthRange.start, end: todayIso };
  const mtdExpense = computeBehavioralExpense(input.txs, monthToDateRange);
  const daysElapsed = Math.max(1, daysInclusive(monthRange.start, todayIso));
  const daysTotal = daysInclusive(monthRange.start, monthRange.end);
  const daysRemainingInMonth = Math.max(0, daysTotal - daysElapsed);
  const mtdAvg = round2(mtdExpense / daysElapsed);
  const projectedRemainingConsumption = round2(mtdAvg * daysRemainingInMonth);

  const availUntilEnd = computeAvailableUntil({
    accounts: input.accounts,
    txs: input.txs,
    recurring: input.recurring,
    snapshots: input.snapshots,
    endDate: monthRange.end,
    today,
    // Nunca reconstruir dívida de cartão por transações quando há exposição oficial.
    cardDebtOverride: hasCardSource ? cardDebtToday : null,
  });

  const confirmedFutureIncome = round2(availUntilEnd.plannedIncome + availUntilEnd.recurringIn);
  const knownFutureCommitments = round2(availUntilEnd.plannedExpense + availUntilEnd.recurringOut);
  const projectedMonthEndAvailable = round2(
    availableToday + confirmedFutureIncome - knownFutureCommitments - cardDebtToday - projectedRemainingConsumption,
  );

  const categoryNameById = input.categoryNameById ?? {};
  const activeCategoryGoals: CategoryGoalEvaluation[] = input.categoryGoals
    .filter((g) => g.status === "active")
    .map((g) => evaluateCategoryGoal(g, input.txs, today, categoryNameById[g.category_id]));

  const topCategoryGoal = pickTopGoal(activeCategoryGoals);

  const currentYM = todayIso.slice(0, 7);
  const monthlyTotalsRaw = computeMonthlyTotals(input.txs, currentYM);
  const categories: CategoryRow[] = input.categories
    ?? Object.entries(categoryNameById).map(([id, name]) => ({ id, name, type: "expense" as const }));
  const categoryBreakdown = computeCategoryBreakdown(input.txs, categories, currentYM, "expense");
  const activeDebtTotal = computeActiveDebtsTotal(input.debts);
  const investmentsTotal = computeInvestmentsTotal(input.investments);
  const investedPrincipal = computeInvestedPrincipal(input.investments);
  const goalProgress: SnapshotGoalProgress[] = (input.goals ?? [])
    .filter((g) => g.status === "active")
    .map((g) => {
      const p = computeGoalProgressFacts(
        g.target_amount,
        g.id,
        input.goalContributions ?? [],
        input.investments,
      );
      return { id: g.id, name: g.name, target: Number(g.target_amount) || 0, ...p };
    });
  const upcomingCommitments = computeUpcomingCommitments(input.recurring, input.txs, 30);

  return {
    contractVersion: FINANCE_CONTRACT_VERSION,
    monthlyTotals: { month: currentYM, ...monthlyTotalsRaw },
    categoryBreakdown,
    activeDebtTotal,
    investmentsTotal,
    investedPrincipal,
    goalProgress,
    upcomingCommitments,
    today: todayIso,
    period: input.period,
    availableToday,
    netWorth,
    currentAverageDailyConsumption: rhythm.current.average,
    previousAverageDailyConsumption: rhythm.previous.average,
    averageDailyVariationPct: rhythm.averageDeltaPct,
    rhythm,
    currentCardSpend: card.current,
    previousCardSpend: card.previous,
    cardSpendVariationPct: card.deltaPct,
    daysRemainingInMonth,
    monthToDateAverageConsumption: mtdAvg,
    projectedRemainingConsumption,
    confirmedFutureIncome,
    knownFutureCommitments,
    projectedMonthEndAvailable,
    activeCategoryGoals,
    topCategoryGoal,
    cardExposures,
    cardDebtToday,
    cardFutureInstallments,
    cardDebtIsEstimated,
  };
}

function pickTopGoal(list: CategoryGoalEvaluation[]): CategoryGoalEvaluation | null {
  if (list.length === 0) return null;
  const rank = (s: CategoryGoalStatus): number => {
    switch (s) {
      case "exceeded": return 5;
      case "at_risk": return 4;
      case "limit_reached": return 3;
      case "attention": return 2;
      case "on_track": return 1;
      case "scheduled":
      case "completed_ok":
      case "completed_over":
      case "paused":
      case "cancelled":
      default: return 0;
    }
  };
  return [...list].sort((a, b) => {
    const dr = rank(b.status) - rank(a.status);
    if (dr !== 0) return dr;
    return b.percentageUsed - a.percentageUsed;
  })[0];
}
