// Snapshot financeiro para o agente (WhatsApp + App) — financial_snapshot_contract.v9.
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
  period_type: string;
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
  calculation_reference_date: string;
  included_transaction_count: number;
  /** `category_projection.v1`: natureza da categoria decide o método. */
  projection_method: "linear" | "weekday_weighted" | "flow" | "commitment" | "hybrid" | "insufficient_data";
  projection_confidence: "high" | "medium" | "low";
  supports_daily_budget: boolean;
  remaining_known_commitments: number;
}

function flattenGoal(e: CoreGoalEvaluation): CategoryGoalEvaluation {
  return {
    goal_id: e.goal.id,
    category_id: e.goal.category_id,
    category_name: e.categoryName,
    period_start: e.period.start,
    period_end: e.period.end,
    period_type: e.periodType,
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
    calculation_reference_date: e.calculationReferenceDate,
    included_transaction_count: e.includedTransactionCount,
    projection_method: e.projectionMethod,
    projection_confidence: e.projectionConfidence,
    supports_daily_budget: e.supportsDailyBudget,
    remaining_known_commitments: e.remainingKnownCommitments,
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
  /** Obrigação do cartão que vence na competência atual. */
  card_due_this_month: number;
  card_due_estimated: boolean;
  current_month_income: number;
  current_month_expense: number;
  days_elapsed: number;
  days_remaining: number;
  daily_pace: number;
  /** Ritmo típico (mediana robusta) do núcleo spending_rhythm.v3. */
  typical_daily_pace: number;
  projected_remaining_consumption: number;
  confirmed_future_income: number;
  estimated_fixed_income: number;
  estimated_income_events: Array<{ date: string; amount: number; label: string; source: string; confidence: string }>;
  known_future_commitments: number;
  projected_month_end_available: number;
  net_worth: number;
  /** Composição do patrimônio (mesma fonte do número acima, nunca recalculada fora). */
  net_worth_composition: {
    cash: number;
    invested: number;
    assets: number;
    account_overdraft: number;
    cards_owed: number;
    other_debts: number;
    owed: number;
    net: number;
  };
  active_debts: Array<{ id: string; name: string; outstanding_balance: number; installment_amount: number | null; due_day: number | null }>;
  /** Quantidade integral de transações lidas após paginação; usada na proveniência. */
  source_transaction_count: number;
  reconciliation_id: string;
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
  /** Agenda canônica de compromissos (commitment_agenda.v2) — datas e valores já apurados. */
  commitment_agenda: {
    horizon_start: string;
    horizon_end: string;
    total_income: number;
    total_expense: number;
    has_estimates: boolean;
    items: Array<{
      name: string;
      type: "income" | "expense";
      amount: number;
      date: string;
      source: string;
      estimated: boolean;
    }>;
  };
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

const AGENT_TRANSACTION_SELECT = "id,account_id,category_id,type,status,amount,refund_of_transaction_id,merchant_name,friendly_description,origin,installments_total,occurred_at,posted_at,posted_at_source,purchase_date,behavioral_day,behavior_date_source,behavior_date_confidence,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,investment_id,competence_date";

/** PostgREST limita respostas por padrão; saldo e projeção não podem usar
 * silenciosamente apenas as primeiras 1.000 transações. */
async function fetchAllAgentTransactions(sb: SupabaseClient, user_id: string) {
  const pageSize = 1_000;
  const rows: any[] = [];
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const { data, error } = await sb.from("transactions")
      .select(AGENT_TRANSACTION_SELECT)
      .eq("user_id", user_id)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`snapshot_source_transactions:${error.message}`);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) return { data: rows, error: null };
  }
  throw new Error("snapshot_source_transactions:limit_exceeded");
}

function addDaysISO(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextDueForRule(rule: any, today: string, horizonEnd: string): string | null {
  const start = String(rule.start_date ?? today).slice(0, 10);
  const end = rule.end_date ? String(rule.end_date).slice(0, 10) : horizonEnd;
  let cursor = start > today ? start : today;
  const wantedDay = Math.max(1, Math.min(31, Number(rule.day_of_month ?? 1)));
  const wantedWeekday = Number(rule.weekday ?? 1);
  const startDate = new Date(`${start}T12:00:00Z`);
  while (cursor <= horizonEnd && cursor <= end) {
    const date = new Date(`${cursor}T12:00:00Z`);
    const matches = rule.frequency === "daily"
      || (rule.frequency === "weekly" && date.getUTCDay() === wantedWeekday)
      || (rule.frequency === "monthly" && date.getUTCDate() === Math.min(wantedDay, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()))
      || (rule.frequency === "yearly" && date.getUTCMonth() === startDate.getUTCMonth() && date.getUTCDate() === startDate.getUTCDate());
    if (matches && cursor >= start) return cursor;
    date.setUTCDate(date.getUTCDate() + 1);
    cursor = date.toISOString().slice(0, 10);
  }
  return null;
}

export async function computeAgentSnapshot(
  sb: SupabaseClient,
  user_id: string,
): Promise<AgentFinancialSnapshot> {
  const todayIso = todaySP();
  const mr = monthRangeOf(todayIso);
  const rollingHorizon = addDaysISO(todayIso, 35);
  const recurringHorizon = mr.end > rollingHorizon ? mr.end : rollingHorizon;

  const [
    accountsRes, txsRes, recurringRes, catGoalsRes, catNamesRes,
    snapshotsRes, investmentsRes, debtsRes, cardsRes, statementsRes, installmentsRes,
    investmentMovementsRes, settingsRes, occurrencesRes, goalsRes, contributionsRes,
  ] = await Promise.all([
    // Posição financeira inclui as mesmas contas que a Home. `active` limita
    // novas operações, mas não pode fazer um saldo histórico sumir só no agente.
    sb.from("accounts").select("id,name,type,opening_balance,active").eq("user_id", user_id),
    fetchAllAgentTransactions(sb, user_id),
    sb.from("recurring_rules")
      .select("id,name,kind,amount,frequency,start_date,end_date,day_of_month,weekday,status")
      .eq("user_id", user_id).eq("status", "active"),
    sb.from("category_spending_goals").select("*").eq("user_id", user_id).eq("status", "active"),
    sb.from("categories").select("id,name,type").or(`user_id.eq.${user_id},user_id.is.null`).is("archived_at", null),
    sb.from("account_balance_snapshots").select("account_id,balance_date,balance,status,anchor_kind,source_document_id,reconciliation_delta").eq("user_id", user_id),
    sb.from("investments").select("*").eq("user_id", user_id),
    sb.from("debts").select("*").eq("user_id", user_id),
    // Cartão inativo ainda pode ter fatura/parcelas em aberto. A flag `active`
    // controla novas compras, não apaga obrigações já contratadas.
    sb.from("credit_cards").select("id,name,total_limit,closing_day,due_day,active").eq("user_id", user_id),
    sb.from("credit_card_statements")
      .select("id,credit_card_id,competence_month,due_date,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status")
      .eq("user_id", user_id),
    sb.from("credit_card_installments")
      .select("id,credit_card_id,competence_month,amount,status,absorbed_by_statement_id,legacy_transaction_id")
      .eq("user_id", user_id),
    sb.from("investment_movements").select("kind,amount,occurred_at").eq("user_id", user_id),
    sb.from("user_financial_settings").select("approximate_monthly_income,income_frequency,income_day").eq("user_id", user_id).maybeSingle(),
    sb.from("recurring_occurrences").select("recurring_rule_id,due_date,status").eq("user_id", user_id).eq("status", "planned").gte("due_date", todayIso).lte("due_date", recurringHorizon),
    sb.from("goals").select("id,name,target_amount,target_date,status,kind,donation_mode,donation_percent,monthly_target,donation_income_scope,donation_income_category_ids,donation_due_day,donation_end_date").eq("user_id", user_id),
    sb.from("goal_contributions").select("goal_id,amount,occurred_at").eq("user_id", user_id),
  ]);

  const snapshotSources: Array<[string, { error?: { message?: string } | null }]> = [
    ["accounts", accountsRes], ["recurring", recurringRes], ["category_goals", catGoalsRes],
    ["categories", catNamesRes], ["account_snapshots", snapshotsRes], ["investments", investmentsRes],
    ["debts", debtsRes], ["cards", cardsRes], ["card_statements", statementsRes],
    ["card_installments", installmentsRes], ["investment_movements", investmentMovementsRes],
    ["financial_settings", settingsRes], ["recurring_occurrences", occurrencesRes],
    ["goals", goalsRes], ["goal_contributions", contributionsRes],
  ];
  for (const [source, response] of snapshotSources) {
    if (response.error) throw new Error(`snapshot_source_${source}:${response.error.message ?? "query_failed"}`);
  }

  const accounts = (accountsRes.data ?? []) as AccountRow[];
  const txs = ((txsRes.data ?? []) as any[]).map((t) => ({ ...t, amount: Number(t.amount) })) as TransactionRow[];
  const nextDueByRule = new Map<string, string>();
  for (const occurrence of ((occurrencesRes.data ?? []) as any[])) {
    const id = String(occurrence.recurring_rule_id);
    const due = String(occurrence.due_date).slice(0, 10);
    if (!nextDueByRule.has(id) || due < String(nextDueByRule.get(id))) nextDueByRule.set(id, due);
  }
  const recurring: RecurringRow[] = ((recurringRes.data ?? []) as any[]).flatMap((r) => {
    const nextDue = nextDueByRule.get(String(r.id)) ?? nextDueForRule(r, todayIso, recurringHorizon);
    if (!nextDue) return [];
    return [{
    id: r.id,
    name: r.name,
    type: r.kind === "income" ? "income" : "expense",
    amount: Number(r.amount || 0),
    frequency: (["daily", "weekly", "monthly", "yearly"].includes(r.frequency) ? r.frequency : "monthly") as RecurringRow["frequency"],
    next_due_date: nextDue,
    active: true,
    }];
  });
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
    categories: ((catNamesRes.data ?? []) as any[]).map((category) => ({ id: category.id, name: category.name, type: category.type })),
    goals: ((goalsRes.data ?? []) as any[]).map((goal) => ({
      ...goal,
      target_amount: Number(goal.target_amount || 0),
      donation_percent: goal.donation_percent == null ? null : Number(goal.donation_percent),
      monthly_target: goal.monthly_target == null ? null : Number(goal.monthly_target),
    })),
    goalContributions: ((contributionsRes.data ?? []) as any[]).map((contribution) => ({ ...contribution, amount: Number(contribution.amount || 0) })),
    period: { start: mr.start, end: mr.end },
    cardStatements: (statementsRes.data ?? []) as CardStatementRow[],
    cardInstallments: (installmentsRes.data ?? []) as CardInstallmentRow[],
    cardIds: ((cardsRes.data ?? []) as any[]).map((c) => c.id),
    cards: ((cardsRes.data ?? []) as any[]).map((card) => ({
      id: card.id, name: card.name, closing_day: card.closing_day, due_day: card.due_day,
    })),
    // A coluna canônica é `kind`; o contrato da ponte usa `type`.
    investmentMovements: ((investmentMovementsRes.data ?? []) as any[]).map((m) => ({
      type: String(m.kind), amount: Number(m.amount || 0), occurred_at: m.occurred_at,
    })),
    incomeSettings: settingsRes.data ? {
      approximate_monthly_income: Number((settingsRes.data as any).approximate_monthly_income || 0),
      income_frequency: (settingsRes.data as any).income_frequency,
      income_day: (settingsRes.data as any).income_day,
    } : null,
  });

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
    card_due_this_month: snap.projection.composition.cardDueThisMonth,
    card_due_estimated: snap.projection.composition.cardDueIsEstimated,
    current_month_income: round2(snap.monthlyTotals.income),
    current_month_expense: round2(snap.monthlyTotals.expense),
    days_elapsed: daysElapsed,
    days_remaining: Math.max(0, daysTotal - daysElapsed),
    daily_pace: snap.monthToDateAverageConsumption,
    typical_daily_pace: snap.rhythm?.current?.typicalAverage ?? snap.monthToDateAverageConsumption,
    projected_remaining_consumption: snap.projectedRemainingConsumption,
    confirmed_future_income: snap.confirmedFutureIncome,
    estimated_fixed_income: snap.projection.estimatedFixedInflows,
    estimated_income_events: snap.projection.estimatedIncomeEvents,
    known_future_commitments: snap.knownFutureCommitments,
    projected_month_end_available: snap.projectedMonthEndAvailable,
    net_worth: snap.netWorth?.net ?? 0,
    net_worth_composition: {
      cash: round2(snap.netWorth?.cash ?? 0),
      invested: round2(snap.netWorth?.invested ?? 0),
      assets: round2(snap.netWorth?.assets ?? 0),
      account_overdraft: round2(snap.netWorth?.accountOverdraft ?? 0),
      cards_owed: round2(snap.netWorth?.cardsOwed ?? 0),
      other_debts: round2(snap.netWorth?.otherDebts ?? 0),
      owed: round2(snap.netWorth?.owed ?? 0),
      net: round2(snap.netWorth?.net ?? 0),
    },
    active_debts: snap.activeDebts.map((debt) => ({
      id: debt.id, name: debt.name, outstanding_balance: debt.outstandingBalance,
      installment_amount: debt.installmentAmount, due_day: debt.dueDay,
    })),
    source_transaction_count: txs.length,
    reconciliation_id: snap.audit.reconciliationId,
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
      reconciliation_difference: snap.netWorthBridge.valuationAdjustments,
      confidence: snap.netWorthBridge.confidence,
    },
    balance_explanation: {
      headline: snap.balanceExplanation.headline,
      body: snap.balanceExplanation.body,
      steps: snap.balanceExplanation.steps,
    },
    commitment_agenda: {
      horizon_start: snap.commitmentAgenda.horizonStart,
      horizon_end: snap.commitmentAgenda.horizonEnd,
      total_income: snap.commitmentAgenda.totalIncome,
      total_expense: snap.commitmentAgenda.totalExpense,
      has_estimates: snap.commitmentAgenda.hasEstimates,
      items: snap.commitmentAgenda.items.map((item) => ({
        name: item.name,
        type: item.type,
        amount: item.amount,
        date: item.date,
        source: String(item.source),
        estimated: item.estimated,
      })),
    },
    formula_version: snap.contractVersion,
  };
}
