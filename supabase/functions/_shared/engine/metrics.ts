// Agent-facing Financial Metrics — porta compacta do FinancialMetricsService
// (src/lib/engine/metrics.ts) para uso das ferramentas do agente. Mantém as
// mesmas fórmulas essenciais para paridade entre App, WhatsApp e Agent Core.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  computeAccountBalances,
  computeCreditCardOutstanding,
  isRealMonthlyMovement,
  round2,
  txOrigin,
  type AccountRow,
  type RecurringRow,
  type TransactionRow,
} from "./facts.ts";

function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function daysInclusive(startIso: string, endIso: string): number {
  const s = new Date(startIso + "T00:00:00Z").getTime();
  const e = new Date(endIso + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
}

function monthRange(today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: todayISO(start), end: todayISO(end) };
}

/** Consumo comportamental (exclui transferências, cartão liquidando fatura,
 *  investimentos, empréstimo etc.). */
function behavioralExpense(txs: TransactionRow[], start: string, end: string): number {
  let total = 0;
  for (const t of txs) {
    if (t.type !== "expense") continue;
    if (!isRealMonthlyMovement(t)) continue;
    if (t.occurred_at < start || t.occurred_at > end) continue;
    total += Number(t.amount || 0);
  }
  return round2(total);
}

/** Próximas ocorrências de recorrentes até `endIso`, expandindo mensal/semanal. */
function futureRecurringTotals(recurring: RecurringRow[], todayIso: string, endIso: string) {
  let inSum = 0, outSum = 0;
  const end = new Date(endIso + "T00:00:00Z").getTime();
  const today = new Date(todayIso + "T00:00:00Z").getTime();
  for (const r of recurring) {
    if (!r.active) continue;
    let cursor = new Date(r.next_due_date + "T00:00:00Z").getTime();
    if (isNaN(cursor)) continue;
    let steps = 0;
    while (cursor <= end && steps < 60) {
      if (cursor >= today) {
        if (r.type === "income") inSum += Number(r.amount || 0);
        else outSum += Number(r.amount || 0);
      }
      const d = new Date(cursor);
      switch (r.frequency) {
        case "daily": d.setUTCDate(d.getUTCDate() + 1); break;
        case "weekly": d.setUTCDate(d.getUTCDate() + 7); break;
        case "yearly": d.setUTCFullYear(d.getUTCFullYear() + 1); break;
        default: d.setUTCMonth(d.getUTCMonth() + 1);
      }
      cursor = d.getTime();
      steps++;
    }
  }
  return { inSum: round2(inSum), outSum: round2(outSum) };
}

function plannedFutureTotals(txs: TransactionRow[], todayIso: string, endIso: string) {
  let inSum = 0, outSum = 0;
  for (const t of txs) {
    if (t.status !== "planned") continue;
    if (t.type === "transfer") continue;
    if (t.occurred_at <= todayIso || t.occurred_at > endIso) continue;
    if (t.type === "income") inSum += Number(t.amount || 0);
    else if (t.type === "expense") outSum += Number(t.amount || 0);
  }
  return { inSum: round2(inSum), outSum: round2(outSum) };
}

export type CategoryGoalMode = "percent_reduction" | "fixed_limit";
export type CategoryGoalStatus = "on_track" | "attention" | "at_risk" | "exceeded";

export interface CategorySpendingGoalRow {
  id: string;
  category_id: string;
  mode: CategoryGoalMode;
  computed_limit: number;
  start_date: string;
  end_date: string | null;
  status: "active" | "paused" | "cancelled";
}

export interface CategoryGoalEvaluation {
  goal_id: string;
  category_id: string;
  category_name?: string;
  limit: number;
  spent: number;
  utilization_pct: number;
  daily_allowance: number;
  projected_spend: number;
  projected_overspend: number;
  days_elapsed: number;
  days_total: number;
  days_remaining: number;
  status: CategoryGoalStatus;
  message: string;
}

export function evaluateCategoryGoal(
  goal: CategorySpendingGoalRow,
  txs: TransactionRow[],
  today: Date,
  categoryName?: string,
): CategoryGoalEvaluation {
  const mr = monthRange(today);
  const start = goal.start_date > mr.start ? goal.start_date : mr.start;
  const end = goal.end_date && goal.end_date < mr.end ? goal.end_date : mr.end;
  const todayIso = todayISO(today);
  const daysTotal = daysInclusive(start, end);
  const daysElapsed = Math.min(daysTotal, daysInclusive(start, todayIso));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);
  let spent = 0;
  for (const t of txs) {
    if (t.category_id !== goal.category_id) continue;
    if (t.type !== "expense") continue;
    if (!isRealMonthlyMovement(t)) continue;
    if (t.occurred_at < start || t.occurred_at > end) continue;
    spent += Number(t.amount || 0);
  }
  spent = round2(Math.max(0, spent));
  const limit = round2(Number(goal.computed_limit || 0));
  const utilization = limit > 0 ? spent / limit : 0;
  const daysProgress = daysTotal > 0 ? daysElapsed / daysTotal : 0;
  const pace = spent / daysElapsed;
  const projected = round2(pace * daysTotal);
  const overspend = round2(Math.max(0, projected - limit));
  const remainingBudget = Math.max(0, limit - spent);
  const daily = daysRemaining > 0 ? round2(remainingBudget / daysRemaining) : 0;
  let status: CategoryGoalStatus = "on_track";
  if (utilization >= 1) status = "exceeded";
  else if (utilization - daysProgress >= 0.25) status = "at_risk";
  else if (utilization - daysProgress >= 0.1) status = "attention";
  const name = categoryName ?? "categoria";
  const message =
    status === "exceeded" ? `Você já ultrapassou o limite em ${name}.` :
    status === "at_risk" ? `Ritmo de ${name} projeta estouro; ajuste para ~R$ ${daily.toFixed(2)}/dia.` :
    status === "attention" ? `Atenção com ${name}: ritmo levemente acima do plano.` :
    `Você está no ritmo em ${name}.`;
  return {
    goal_id: goal.id, category_id: goal.category_id, category_name: categoryName,
    limit, spent,
    utilization_pct: round2(utilization),
    daily_allowance: daily,
    projected_spend: projected,
    projected_overspend: overspend,
    days_elapsed: daysElapsed, days_total: daysTotal, days_remaining: daysRemaining,
    status, message,
  };
}

export interface AgentFinancialSnapshot {
  today: string;
  month_start: string;
  month_end: string;
  available_today: number;
  cards_owed: number;
  current_month_income: number;
  current_month_expense: number;
  days_elapsed: number;
  days_remaining: number;
  daily_pace: number;
  projected_remaining_consumption: number;
  confirmed_future_income: number;
  known_future_commitments: number;
  projected_month_end_available: number;
  active_category_goals: CategoryGoalEvaluation[];
  top_category_goal: CategoryGoalEvaluation | null;
}

export async function computeAgentSnapshot(
  sb: SupabaseClient,
  user_id: string,
): Promise<AgentFinancialSnapshot> {
  const today = new Date();
  const mr = monthRange(today);
  const todayIso = todayISO(today);

  const [accountsRes, txsRes, recurringRes, catGoalsRes, catNamesRes] = await Promise.all([
    sb.from("accounts").select("id,name,type,opening_balance,active").eq("user_id", user_id).eq("active", true),
    sb.from("transactions")
      .select("id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind")
      .eq("user_id", user_id),
    sb.from("recurring_rules")
      .select("id,name,kind,amount,frequency,next_due_date,status")
      .eq("user_id", user_id).eq("status", "active"),
    sb.from("category_spending_goals")
      .select("id,category_id,mode,computed_limit,start_date,end_date,status")
      .eq("user_id", user_id).eq("status", "active"),
    sb.from("categories").select("id,name").or(`user_id.eq.${user_id},user_id.is.null`),
  ]);

  const accounts = (accountsRes.data ?? []) as AccountRow[];
  const txs = ((txsRes.data ?? []) as any[]).map((t) => ({ ...t, amount: Number(t.amount) })) as TransactionRow[];
  const recurring: RecurringRow[] = ((recurringRes.data ?? []) as any[]).map((r) => ({
    id: r.id, name: r.name,
    type: (r.kind === "income" ? "income" : "expense"),
    amount: Number(r.amount || 0),
    frequency: (["daily","weekly","monthly","yearly"].includes(r.frequency) ? r.frequency : "monthly") as RecurringRow["frequency"],
    next_due_date: r.next_due_date,
    active: true,
  }));

  const balances = computeAccountBalances(accounts, txs);
  const availableToday = round2(Object.values(balances).reduce((a, b) => a + b, 0));
  const cardsOwed = computeCreditCardOutstanding(txs);

  // Totais do mês corrente.
  let incomeMTD = 0, expenseMTD = 0;
  for (const t of txs) {
    if (t.occurred_at < mr.start || t.occurred_at > mr.end) continue;
    if (t.status !== "confirmed") continue;
    if (t.type === "transfer") continue;
    // Entradas brutas em conta / cartão consumo bruto — usa mesma regra da Home.
    if (txOrigin(t) === "account") {
      if (t.type === "income") incomeMTD += Number(t.amount || 0);
      else if (t.type === "expense") expenseMTD += Number(t.amount || 0);
    } else if (t.type === "expense") {
      expenseMTD += Number(t.amount || 0); // cartão consumido
    }
  }

  const mtdBehavioral = behavioralExpense(txs, mr.start, todayIso);
  const daysElapsed = Math.max(1, daysInclusive(mr.start, todayIso));
  const daysTotal = daysInclusive(mr.start, mr.end);
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);
  const dailyPace = round2(mtdBehavioral / daysElapsed);
  const projectedRemaining = round2(dailyPace * daysRemaining);

  const rec = futureRecurringTotals(recurring, todayIso, mr.end);
  const plan = plannedFutureTotals(txs, todayIso, mr.end);
  const confirmedFutureIncome = round2(rec.inSum + plan.inSum);
  const knownFutureCommitments = round2(rec.outSum + plan.outSum);
  const projectedMonthEnd = round2(
    availableToday + confirmedFutureIncome - knownFutureCommitments - cardsOwed - projectedRemaining,
  );

  const catNames = new Map<string, string>();
  for (const c of ((catNamesRes.data ?? []) as any[])) catNames.set(c.id, c.name);
  const goals: CategoryGoalEvaluation[] = ((catGoalsRes.data ?? []) as any[]).map((g) =>
    evaluateCategoryGoal(
      {
        id: g.id, category_id: g.category_id,
        mode: g.mode, computed_limit: Number(g.computed_limit || 0),
        start_date: g.start_date, end_date: g.end_date, status: g.status,
      },
      txs, today, catNames.get(g.category_id),
    ),
  );
  const rank = (s: CategoryGoalStatus) => ({ exceeded: 3, at_risk: 2, attention: 1, on_track: 0 } as const)[s];
  const top = goals.length === 0 ? null : [...goals].sort((a, b) => {
    const dr = rank(b.status) - rank(a.status);
    if (dr !== 0) return dr;
    return b.utilization_pct - a.utilization_pct;
  })[0];

  return {
    today: todayIso,
    month_start: mr.start,
    month_end: mr.end,
    available_today: availableToday,
    cards_owed: cardsOwed,
    current_month_income: round2(incomeMTD),
    current_month_expense: round2(expenseMTD),
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    daily_pace: dailyPace,
    projected_remaining_consumption: projectedRemaining,
    confirmed_future_income: confirmedFutureIncome,
    known_future_commitments: knownFutureCommitments,
    projected_month_end_available: projectedMonthEnd,
    active_category_goals: goals,
    top_category_goal: top,
  };
}
