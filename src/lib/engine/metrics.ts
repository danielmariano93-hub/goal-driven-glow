// FinancialMetricsService (frontend). Núcleo puro que compõe helpers existentes
// e adiciona metas de categoria. Consumido por `useFinancialSnapshot` e por
// componentes da Home. Não faz I/O — só cálculo determinístico.
import {
  computeAvailableUntil,
  computeBehavioralExpense,
  computeNetWorth,
  computeTotalCash,
  computeCreditCardOutstanding,
  isRealMonthlyMovement,
  round2,
  todayISO,
  type AccountRow,
  type AccountBalanceSnapshotRow,
  type DebtRow,
  type InvestmentRow,
  type RecurringRow,
  type TransactionRow,
} from "./facts";
import { computeDailyAverageComparison, computeCardSpendingComparison, daysInclusive, type DateRange } from "./dailyAverage";

export type CategoryGoalMode = "percent_reduction" | "fixed_limit";
export type CategoryGoalBaselineKind = "prev_month" | "avg_3m" | "custom";
export type CategoryGoalStatus = "on_track" | "attention" | "at_risk" | "exceeded";

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
  alerts?: unknown;
}

export interface CategoryGoalEvaluation {
  goal: CategorySpendingGoalRow;
  period: DateRange;
  categoryName?: string;
  spent: number;
  limit: number;
  utilizationPct: number; // spent/limit
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  dailyAllowance: number; // (limit - spent)/daysRemaining
  currentDailyPace: number; // spent/daysElapsed
  projectedSpend: number; // pace × daysTotal
  projectedOverspend: number; // max(0, projected - limit)
  requiredDailyReduction: number; // max(0, (projected - limit)/daysRemaining)
  status: CategoryGoalStatus;
  message: string;
}

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
}

export interface FinancialSnapshot {
  today: string;
  period: DateRange;
  availableToday: number;
  netWorth: ReturnType<typeof computeNetWorth>;
  currentAverageDailyConsumption: number;
  previousAverageDailyConsumption: number;
  averageDailyVariationPct: number | null;
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
}

function inMonthRange(today: Date): DateRange {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: todayISO(start), end: todayISO(end) };
}

function classifyStatus(utilizationPct: number, daysProgressPct: number): CategoryGoalStatus {
  if (utilizationPct >= 1) return "exceeded";
  const drift = utilizationPct - daysProgressPct;
  if (drift >= 0.25) return "at_risk";
  if (drift >= 0.1) return "attention";
  return "on_track";
}

export function evaluateCategoryGoal(
  goal: CategorySpendingGoalRow,
  txs: TransactionRow[],
  today: Date,
  categoryName?: string,
): CategoryGoalEvaluation {
  const monthRange = inMonthRange(today);
  const period: DateRange = {
    start: goal.start_date > monthRange.start ? goal.start_date : monthRange.start,
    end: goal.end_date && goal.end_date < monthRange.end ? goal.end_date : monthRange.end,
  };
  const todayIso = todayISO(today);
  const daysTotal = Math.max(1, daysInclusive(period.start, period.end));
  const daysElapsed = Math.min(daysTotal, Math.max(1, daysInclusive(period.start, todayIso)));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);

  let spent = 0;
  for (const t of txs) {
    if (t.category_id !== goal.category_id) continue;
    if (t.type !== "expense") continue;
    if (!isRealMonthlyMovement(t)) continue;
    if (t.occurred_at < period.start || t.occurred_at > period.end) continue;
    spent += Number(t.amount || 0);
  }
  spent = round2(Math.max(0, spent));

  const limit = round2(Number(goal.computed_limit || 0));
  const utilizationPct = limit > 0 ? spent / limit : 0;
  const daysProgressPct = daysTotal > 0 ? daysElapsed / daysTotal : 0;
  const currentDailyPace = round2(spent / daysElapsed);
  const projectedSpend = round2(currentDailyPace * daysTotal);
  const projectedOverspend = round2(Math.max(0, projectedSpend - limit));
  const remainingBudget = round2(Math.max(0, limit - spent));
  const dailyAllowance = daysRemaining > 0 ? round2(remainingBudget / daysRemaining) : 0;
  const requiredDailyReduction = daysRemaining > 0 && projectedOverspend > 0
    ? round2(projectedOverspend / daysRemaining)
    : 0;
  const status = classifyStatus(utilizationPct, daysProgressPct);

  const name = categoryName ?? "categoria";
  const message =
    status === "exceeded"
      ? `Você já ultrapassou o limite em ${name}.`
      : status === "at_risk"
      ? `Ritmo de ${name} projeta estouro; ajuste ${dailyAllowance > 0 ? `para ~R$ ${dailyAllowance.toFixed(2)}/dia` : "agora"}.`
      : status === "attention"
      ? `Atenção com ${name}: ritmo levemente acima do plano.`
      : `Você está no ritmo em ${name}.`;

  return {
    goal,
    period,
    categoryName,
    spent,
    limit,
    utilizationPct: round2(utilizationPct),
    daysElapsed,
    daysTotal,
    daysRemaining,
    dailyAllowance,
    currentDailyPace,
    projectedSpend,
    projectedOverspend,
    requiredDailyReduction,
    status,
    message,
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

  // Disponível hoje (não desconta fatura futura) = saldo em conta líquido atual.
  const availableToday = computeTotalCash(input.accounts, input.txs, input.snapshots);

  const netWorth = computeNetWorth(
    input.accounts,
    input.txs,
    input.investments,
    input.debts,
    input.snapshots,
  );

  const daily = computeDailyAverageComparison(input.txs, input.period);
  const card = computeCardSpendingComparison(input.txs, input.period);

  // Projeção fim de mês: usa consumo médio do mês corrente até hoje × dias restantes
  // + compromissos futuros conhecidos (recorrências + planned) - entradas futuras.
  const monthRange = inMonthRange(today);
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
  });

  // Compromissos e receitas futuras já vieram de computeAvailableUntil,
  // mas queremos expor separadamente. A fatura atual JÁ está em availableUntil
  // (deduzida); aqui projeção fim de mês subtrai adicionalmente o consumo projetado.
  const confirmedFutureIncome = round2(availUntilEnd.plannedIncome + availUntilEnd.recurringIn);
  const knownFutureCommitments = round2(availUntilEnd.plannedExpense + availUntilEnd.recurringOut);
  const cardsOwed = computeCreditCardOutstanding(input.txs);
  const projectedMonthEndAvailable = round2(
    availableToday + confirmedFutureIncome - knownFutureCommitments - cardsOwed - projectedRemainingConsumption,
  );

  const categoryNameById = input.categoryNameById ?? {};
  const activeCategoryGoals: CategoryGoalEvaluation[] = input.categoryGoals
    .filter((g) => g.status === "active")
    .map((g) => evaluateCategoryGoal(g, input.txs, today, categoryNameById[g.category_id]));

  const topCategoryGoal = pickTopGoal(activeCategoryGoals);

  return {
    today: todayIso,
    period: input.period,
    availableToday,
    netWorth,
    currentAverageDailyConsumption: daily.current.avg,
    previousAverageDailyConsumption: daily.previous.avg,
    averageDailyVariationPct: daily.deltaPct,
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
  };
}

function pickTopGoal(list: CategoryGoalEvaluation[]): CategoryGoalEvaluation | null {
  if (list.length === 0) return null;
  const rank = (s: CategoryGoalStatus) => ({ exceeded: 3, at_risk: 2, attention: 1, on_track: 0 } as const)[s];
  return [...list].sort((a, b) => {
    const dr = rank(b.status) - rank(a.status);
    if (dr !== 0) return dr;
    return b.utilizationPct - a.utilizationPct;
  })[0];
}
