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
export type CategoryGoalStatus =
  | "on_track" | "attention" | "at_risk" | "exceeded"
  | "scheduled" | "limit_reached" | "completed_ok" | "completed_over"
  | "paused" | "cancelled";
export type CategoryGoalPeriodType =
  | "this_month" | "next_month" | "next_30_days" | "custom" | "monthly_recurring";

export interface CategorySpendingGoalRow {
  id: string;
  category_id: string;
  mode: CategoryGoalMode;
  computed_limit: number;
  start_date: string;
  end_date: string | null;
  status: "active" | "paused" | "cancelled";
  period_type?: CategoryGoalPeriodType | null;
}

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
  status: CategoryGoalStatus;
  message: string;
  // Aliases legados
  limit: number;
  spent: number;
  utilization_pct: number;
  projected_spend: number;
  projected_overspend: number;
  days_elapsed: number;
  days_total: number;
  days_remaining: number;
}

function resolveGoalPeriod(goal: CategorySpendingGoalRow, today: Date): { start: string; end: string } {
  const type: CategoryGoalPeriodType = (goal.period_type ?? (goal.end_date ? "custom" : "monthly_recurring")) as CategoryGoalPeriodType;
  const todayIso = todayISO(today);
  if (type === "monthly_recurring") {
    if (todayIso < goal.start_date) {
      const gs = new Date(goal.start_date + "T00:00:00");
      return {
        start: todayISO(new Date(gs.getFullYear(), gs.getMonth(), 1)),
        end: todayISO(new Date(gs.getFullYear(), gs.getMonth() + 1, 0)),
      };
    }
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: todayISO(start), end: todayISO(end) };
  }
  return { start: goal.start_date, end: goal.end_date ?? goal.start_date };
}

function classifyStatus(
  goal: CategorySpendingGoalRow, today: Date, start: string, end: string,
  spent: number, limit: number, projected: number,
): CategoryGoalStatus {
  if (goal.status === "cancelled") return "cancelled";
  if (goal.status === "paused") return "paused";
  const todayIso = todayISO(today);
  if (todayIso < start) return "scheduled";
  if (spent > limit) return todayIso > end ? "completed_over" : "exceeded";
  if (todayIso > end) return spent <= limit ? "completed_ok" : "completed_over";
  if (spent === limit) return "limit_reached";
  const overage = Math.max(0, projected - limit);
  if (overage > limit * 0.1) return "at_risk";
  if (overage > 0) return "attention";
  return "on_track";
}

export function evaluateCategoryGoal(
  goal: CategorySpendingGoalRow,
  txs: TransactionRow[],
  today: Date,
  categoryName?: string,
): CategoryGoalEvaluation {
  const { start, end } = resolveGoalPeriod(goal, today);
  const todayIso = todayISO(today);
  const totalDays = daysInclusive(start, end);
  const refIso = todayIso < end ? todayIso : end;
  const elapsedDays = todayIso < start ? 0 : Math.min(totalDays, daysInclusive(start, refIso));
  const remainingDays = todayIso < start ? totalDays : todayIso >= end ? 0 : Math.max(0, totalDays - elapsedDays);

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
  const currentDailyRate = elapsedDays > 0 ? round2(spent / elapsedDays) : 0;
  const projectedLinear = elapsedDays > 0 ? round2(spent + currentDailyRate * remainingDays) : spent;
  const projected = Math.max(spent, projectedLinear);
  const overage = round2(Math.max(0, projected - limit));
  const currentOverage = round2(Math.max(0, spent - limit));
  const remainingBudget = Math.max(0, limit - spent);
  const daily = spent >= limit || remainingDays === 0 ? 0 : round2(remainingBudget / remainingDays);
  const allowedRate = remainingDays > 0 ? remainingBudget / remainingDays : 0;
  const requiredReduction = overage > 0 && remainingDays > 0
    ? round2(Math.max(0, currentDailyRate - allowedRate))
    : 0;
  const status = classifyStatus(goal, today, start, end, spent, limit, projected);
  const util = limit > 0 ? spent / limit : 0;
  const name = categoryName ?? "categoria";
  const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  const message =
    status === "exceeded" ? `Você ultrapassou o limite de ${name} em ${brl(currentOverage)}.` :
    status === "at_risk" ? `${name}: reduza aprox. ${brl(requiredReduction)} por dia para ficar dentro da meta.` :
    status === "attention" ? `${name}: pode ultrapassar a meta em ${brl(overage)} no ritmo atual.` :
    status === "limit_reached" ? `${name}: limite atingido e ainda faltam ${remainingDays} dia(s).` :
    status === "completed_over" ? `${name}: encerrada ${brl(currentOverage)} acima da meta.` :
    status === "completed_ok" ? `${name}: encerrada dentro do limite.` :
    status === "scheduled" ? `${name}: meta começa em ${start}.` :
    status === "paused" ? `${name}: meta pausada.` :
    status === "cancelled" ? `${name}: meta cancelada.` :
    `${name}: no ritmo atual, deve terminar em ${brl(projected)}.`;

  return {
    goal_id: goal.id,
    category_id: goal.category_id,
    category_name: categoryName,
    period_start: start,
    period_end: end,
    target_amount: limit,
    actual_spend: spent,
    remaining_amount: round2(limit - spent),
    percentage_used: round2(util),
    elapsed_days: elapsedDays,
    total_days: totalDays,
    remaining_days: remainingDays,
    current_daily_rate: currentDailyRate,
    projected_final_spend: projected,
    projected_overage: overage,
    current_overage: currentOverage,
    daily_allowance: daily,
    required_daily_reduction: requiredReduction,
    status,
    message,
    // Aliases legados
    limit,
    spent,
    utilization_pct: round2(Math.min(1, Math.max(0, util))),
    projected_spend: projected,
    projected_overspend: overage,
    days_elapsed: elapsedDays,
    days_total: totalDays,
    days_remaining: remainingDays,
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
