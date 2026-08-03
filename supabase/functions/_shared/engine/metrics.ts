// Snapshot financeiro para o agente (WhatsApp + App) — finance_contract.v4.
// ========================================================================
// NÃO calcula nada por conta própria: busca os dados e delega ao núcleo
// canônico `finance-core` (espelho de src/lib/engine/*). A saída mantém o
// contrato flat em snake_case consumido pelas tools/FinancialContext360.
// deno-lint-ignore-file no-explicit-any
type SupabaseClient = any;

import {
  computeFinancialSnapshot,
  round2,
  todaySP,
  txOrigin,
  type AccountBalanceSnapshotRow,
  type AccountRow,
  type CardInstallmentRow,
  type CardStatementRow,
  type CategoryGoalEvaluation as CoreGoalEvaluation,
  type CategorySpendingGoalRow,
  type DebtRow,
  type InvestmentRow,
  type RecurringRow,
  type TransactionRow,
} from "../finance-core/index.ts";

export { evaluateCategoryGoal, resolveGoalPeriod } from "../finance-core/metrics.ts";
export type {
  CategoryGoalMode,
  CategoryGoalStatus,
  CategoryGoalPeriodType,
  CategorySpendingGoalRow,
} from "../finance-core/metrics.ts";

/** Contrato flat (legado) de meta por categoria exposto às tools. */
export interface CategoryGoalEvaluation {
  goal_id: string;
  category_id: string;
  category_name?: string;
  period_start: string;
  period_end: string;
  target_amount: number;
  actual_spend: number;
  remaining_amount: number;
  percentage_used: number;
  elapsed_days: number;
  total_days: number;
  remaining_days: number;
  current_daily_rate: number;
  projected_final_spend: number;
  projected_overage: number;
  current_overage: number;
  daily_allowance: number;
  required_daily_reduction: number;
  status: string;
  message: string;
  limit: number;
  spent: number;
  utilization_pct: number;
  projected_spend: number;
  projected_overspend: number;
  days_elapsed: number;
  days_total: number;
  days_remaining: number;
}

function flattenGoal(e: CoreGoalEvaluation): CategoryGoalEvaluation {
  return {
    goal_id: e.goal.id,
    category_id: e.goal.category_id,
    category_name: e.categoryName,
    period_start: e.period.start,
    period_end: e.period.end,
    target_amount: e.targetAmount,
    actual_spend: e.actualSpend,
    remaining_amount: e.remainingAmount,
    percentage_used: e.percentageUsed,
    elapsed_days: e.elapsedDays,
    total_days: e.totalDays,
    remaining_days: e.remainingDays,
    current_daily_rate: e.currentDailyRate,
    projected_final_spend: e.projectedFinalSpend,
    projected_overage: e.projectedOverage,
    current_overage: e.currentOverage,
    daily_allowance: e.dailyAllowance,
    required_daily_reduction: e.requiredDailyReduction,
    status: e.status,
    message: e.message,
    limit: e.limit,
    spent: e.spent,
    utilization_pct: e.utilizationPct,
    projected_spend: e.projectedSpend,
    projected_overspend: e.projectedOverspend,
    days_elapsed: e.daysElapsed,
    days_total: e.daysTotal,
    days_remaining: e.daysRemaining,
  };
}

export interface AgentFinancialSnapshot {
  today: string;
  month_start: string;
  month_end: string;
  available_today: number;
  /** Dívida de cartão hoje — faturas não liquidadas (nunca compras do período). */
  cards_owed: number;
  /** true quando algum valor de cartão veio de estimativa (sem fatura oficial). */
  cards_owed_estimated: boolean;
  /** Compromisso futuro de parcelas — NÃO é dívida atual. */
  card_future_installments: number;
  current_month_income: number;
  current_month_expense: number;
  days_elapsed: number;
  days_remaining: number;
  daily_pace: number;
  /** Ritmo típico (mediana robusta) do núcleo spending_rhythm.v3. */
  typical_daily_pace: number;
  projected_remaining_consumption: number;
  confirmed_future_income: number;
  known_future_commitments: number;
  projected_month_end_available: number;
  net_worth: number;
  active_category_goals: CategoryGoalEvaluation[];
  top_category_goal: CategoryGoalEvaluation | null;
  /** Ponte de caixa do mês (finance_contract.v4) — como o saldo se formou. */
  cash_bridge: {
    opening_cash: number;
    closing_cash: number;
    operational_income: number;
    operational_account_expense: number;
    investment_applications: number;
    investment_redemptions: number;
    card_payments: number;
    loan_proceeds: number;
    debt_principal_payments: number;
    external_transfers_in: number;
    external_transfers_out: number;
    refunds_and_reimbursements: number;
    adjustments: number;
    reconciliation_difference: number;
    confidence: string;
  };
  /** Resultado comportamental do período (nunca exibir isolado como saldo). */
  period_performance: {
    operational_income: number;
    operational_expense: number;
    operational_result: number;
    operational_gap: number;
    savings_rate: number | null;
  };
  /** Ponte patrimonial do mês. */
  net_worth_bridge: {
    opening_net_worth: number;
    closing_net_worth: number;
    reconciliation_difference: number;
    confidence: string;
  };
  /** Explicação determinística (sem LLM) de como o saldo se formou. */
  balance_explanation: { headline: string; body: string; steps: string[] };
  formula_version: string;
}

function monthRangeOf(todayIso: string) {
  const [y, m] = todayIso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}

function daysInclusive(a: string, b: string): number {
  const s = new Date(a + "T00:00:00Z").getTime();
  const e = new Date(b + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
}

export async function computeAgentSnapshot(
  sb: SupabaseClient,
  user_id: string,
): Promise<AgentFinancialSnapshot> {
  const todayIso = todaySP();
  const mr = monthRangeOf(todayIso);

  const [
    accountsRes, txsRes, recurringRes, catGoalsRes, catNamesRes,
    snapshotsRes, investmentsRes, debtsRes, cardsRes, statementsRes, installmentsRes,
    investmentMovementsRes,
  ] = await Promise.all([
    sb.from("accounts").select("id,name,type,opening_balance,active").eq("user_id", user_id).eq("active", true),
    sb.from("transactions")
      .select("id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,competence_date")
      .eq("user_id", user_id),
    sb.from("recurring_rules")
      .select("id,name,kind,amount,frequency,next_due_date,status")
      .eq("user_id", user_id).eq("status", "active"),
    sb.from("category_spending_goals").select("*").eq("user_id", user_id).eq("status", "active"),
    sb.from("categories").select("id,name").or(`user_id.eq.${user_id},user_id.is.null`),
    sb.from("account_balance_snapshots").select("account_id,balance_date,balance,status").eq("user_id", user_id),
    sb.from("investments").select("*").eq("user_id", user_id),
    sb.from("debts").select("*").eq("user_id", user_id),
    sb.from("credit_cards").select("id,name,total_limit,closing_day,due_day,active").eq("user_id", user_id).eq("active", true),
    sb.from("credit_card_statements")
      .select("credit_card_id,competence_month,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status")
      .eq("user_id", user_id),
    sb.from("credit_card_installments")
      .select("credit_card_id,competence_month,amount,status,absorbed_by_statement_id")
      .eq("user_id", user_id),
    sb.from("investment_movements").select("kind,amount,occurred_at").eq("user_id", user_id),
  ]);

  const accounts = (accountsRes.data ?? []) as AccountRow[];
  const txs = ((txsRes.data ?? []) as any[]).map((t) => ({ ...t, amount: Number(t.amount) })) as TransactionRow[];
  const recurring: RecurringRow[] = ((recurringRes.data ?? []) as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.kind === "income" ? "income" : "expense",
    amount: Number(r.amount || 0),
    frequency: (["daily", "weekly", "monthly", "yearly"].includes(r.frequency) ? r.frequency : "monthly") as RecurringRow["frequency"],
    next_due_date: r.next_due_date,
    active: true,
  }));
  const catNames: Record<string, string> = {};
  for (const c of ((catNamesRes.data ?? []) as any[])) catNames[c.id] = c.name;

  const snap = computeFinancialSnapshot({
    accounts,
    txs,
    recurring,
    snapshots: (snapshotsRes.data ?? []) as AccountBalanceSnapshotRow[],
    investments: (investmentsRes.data ?? []) as InvestmentRow[],
    debts: (debtsRes.data ?? []) as DebtRow[],
    categoryGoals: (catGoalsRes.data ?? []) as CategorySpendingGoalRow[],
    categoryNameById: catNames,
    period: { start: mr.start, end: mr.end },
    cardStatements: (statementsRes.data ?? []) as CardStatementRow[],
    cardInstallments: (installmentsRes.data ?? []) as CardInstallmentRow[],
    cardIds: ((cardsRes.data ?? []) as any[]).map((c) => c.id),
    // A coluna canônica é `kind`; o contrato da ponte usa `type`.
    investmentMovements: ((investmentMovementsRes.data ?? []) as any[]).map((m) => ({
      type: String(m.kind), amount: Number(m.amount || 0), occurred_at: m.occurred_at,
    })),
  });

  // Entradas/saídas brutas do mês — mesma regra da Home (conta bruta + cartão consumido).
  let incomeMTD = 0, expenseMTD = 0;
  for (const t of txs) {
    if (t.occurred_at < mr.start || t.occurred_at > mr.end) continue;
    if (t.status !== "confirmed") continue;
    if (t.type === "transfer") continue;
    if (txOrigin(t) === "account") {
      if (t.type === "income") incomeMTD += Number(t.amount || 0);
      else if (t.type === "expense") expenseMTD += Number(t.amount || 0);
    } else if (t.type === "expense") {
      expenseMTD += Number(t.amount || 0);
    }
  }

  const daysElapsed = Math.max(1, daysInclusive(mr.start, todayIso));
  const daysTotal = daysInclusive(mr.start, mr.end);

  return {
    today: snap.today,
    month_start: mr.start,
    month_end: mr.end,
    available_today: snap.availableToday,
    cards_owed: snap.cardDebtToday,
    cards_owed_estimated: snap.cardDebtIsEstimated,
    card_future_installments: snap.cardFutureInstallments,
    current_month_income: round2(incomeMTD),
    current_month_expense: round2(expenseMTD),
    days_elapsed: daysElapsed,
    days_remaining: Math.max(0, daysTotal - daysElapsed),
    daily_pace: snap.monthToDateAverageConsumption,
    typical_daily_pace: snap.rhythm?.current?.typicalAverage ?? snap.monthToDateAverageConsumption,
    projected_remaining_consumption: snap.projectedRemainingConsumption,
    confirmed_future_income: snap.confirmedFutureIncome,
    known_future_commitments: snap.knownFutureCommitments,
    projected_month_end_available: snap.projectedMonthEndAvailable,
    net_worth: snap.netWorth?.net ?? 0,
    active_category_goals: snap.activeCategoryGoals.map(flattenGoal),
    top_category_goal: snap.topCategoryGoal ? flattenGoal(snap.topCategoryGoal) : null,
    cash_bridge: {
      opening_cash: snap.cashBridge.openingCash,
      closing_cash: snap.cashBridge.confirmedClosingCash,
      operational_income: snap.cashBridge.operationalIncome,
      operational_account_expense: snap.cashBridge.operationalAccountExpense,
      investment_applications: snap.cashBridge.investmentApplications,
      investment_redemptions: snap.cashBridge.investmentRedemptions,
      card_payments: snap.cashBridge.cardPayments,
      loan_proceeds: snap.cashBridge.loanProceeds,
      debt_principal_payments: snap.cashBridge.debtPrincipalPayments,
      external_transfers_in: snap.cashBridge.externalTransfersIn,
      external_transfers_out: snap.cashBridge.externalTransfersOut,
      refunds_and_reimbursements: snap.cashBridge.refundsAndReimbursements,
      adjustments: snap.cashBridge.adjustments,
      reconciliation_difference: snap.cashBridge.reconciliationDifference,
      confidence: snap.cashBridge.confidence,
    },
    period_performance: {
      operational_income: snap.periodPerformance.operationalIncome,
      operational_expense: snap.periodPerformance.operationalExpense,
      operational_result: snap.periodPerformance.operationalResult,
      operational_gap: snap.periodPerformance.operationalGap,
      savings_rate: snap.periodPerformance.savingsRate,
    },
    net_worth_bridge: {
      opening_net_worth: snap.netWorthBridge.openingNetWorth,
      closing_net_worth: snap.netWorthBridge.closingNetWorth,
      reconciliation_difference: snap.netWorthBridge.reconciliationDifference,
      confidence: snap.netWorthBridge.confidence,
    },
    balance_explanation: {
      headline: snap.balanceExplanation.headline,
      body: snap.balanceExplanation.body,
      steps: snap.balanceExplanation.steps,
    },
    formula_version: "finance_contract.v4",
  };
}
