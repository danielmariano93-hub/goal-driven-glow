// Estratégia de meta: plano determinístico (quanto, onde, como e próximo passo).
// Nada aqui é estimado pelo modelo — todos os números vêm dos dados do cliente.

// deno-lint-ignore-file no-explicit-any
type SupabaseClient = any;

import { buildGoalStrategy, type GoalStrategy } from "../engine/goalStrategy.ts";
import { computeAgentSnapshot } from "../engine/metrics.ts";
import { behavioralMetricAmount, isRealMonthlyMovement, effectiveCategoryId, type TransactionRow } from "../engine/facts.ts";
import { todaySaoPaulo } from "./parser.ts";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function monthKey(date: string): string {
  return String(date).slice(0, 7);
}

function shiftMonth(ym: string, delta: number): string {
  const [year, month] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type GoalStrategyResult = {
  formula_version: "goal_strategy.v1";
  month: string;
  plans: GoalStrategy[];
};

/**
 * Monta o plano de ataque de uma meta (ou de todas as ativas).
 * Fonte de verdade: metas, aportes, snapshot canônico e gasto por categoria.
 */
export async function computeGoalStrategy(
  sb: SupabaseClient,
  userId: string,
  args: { goal_id?: string; goal?: string } = {},
): Promise<GoalStrategyResult> {
  const today = todaySaoPaulo();
  const month = monthKey(today);
  const historyStart = `${shiftMonth(month, -3)}-01`;

  const [snap, goalsRes, contribsRes, investmentsRes, txRes, categoriesRes] = await Promise.all([
    computeAgentSnapshot(sb, userId),
    sb.from("goals")
      .select("id,name,kind,status,target_amount,target_date,monthly_target")
      .eq("user_id", userId).eq("status", "active"),
    sb.from("goal_contributions").select("goal_id,amount,occurred_at").eq("user_id", userId),
    sb.from("investments").select("goal_id,current_value").eq("user_id", userId),
    sb.from("transactions")
      .select("amount,category_id,type,status,movement_kind,occurred_at,payment_method,credit_card_id,refund_of_transaction_id")
      .eq("user_id", userId).eq("type", "expense").eq("status", "confirmed")
      .gte("occurred_at", historyStart),
    sb.from("categories").select("id,name").eq("user_id", userId),
  ]);

  for (const [source, response] of [
    ["goals", goalsRes], ["contributions", contribsRes], ["investments", investmentsRes],
    ["transactions", txRes], ["categories", categoriesRes],
  ] as Array<[string, { error?: { message?: string } | null }]>) {
    if (response.error) throw new Error(`goal_strategy_${source}:${response.error.message ?? "query_failed"}`);
  }

  const categoryName = new Map<string, string>();
  for (const row of ((categoriesRes.data ?? []) as any[])) categoryName.set(row.id, row.name);

  // Gasto por categoria: mês corrente vs média dos 3 meses anteriores (linha de base própria).
  const currentByCategory = new Map<string, number>();
  const priorByCategory = new Map<string, number[]>();
  const priorMonths = new Map<string, Map<string, number>>();
  for (const raw of ((txRes.data ?? []) as any[])) {
    const tx = raw as TransactionRow;
    if (!isRealMonthlyMovement(tx)) continue;
    const amount = behavioralMetricAmount(tx, "expense");
    if (!(amount > 0)) continue;
    const key = effectiveCategoryId(tx) ?? "sem_categoria";
    const ym = monthKey(String((tx as any).occurred_at));
    if (ym === month) {
      currentByCategory.set(key, (currentByCategory.get(key) ?? 0) + amount);
    } else {
      const bucket = priorMonths.get(ym) ?? new Map<string, number>();
      bucket.set(key, (bucket.get(key) ?? 0) + amount);
      priorMonths.set(ym, bucket);
    }
  }
  for (const bucket of priorMonths.values()) {
    for (const [key, value] of bucket.entries()) {
      priorByCategory.set(key, [...(priorByCategory.get(key) ?? []), value]);
    }
  }
  const overspendCategories = [...currentByCategory.entries()].map(([key, value]) => {
    const history = priorByCategory.get(key) ?? [];
    const baseline = history.length
      ? round2(history.reduce((sum, item) => sum + item, 0) / history.length)
      : value;
    return { name: categoryName.get(key) ?? "Sem categoria", monthlyAvg: round2(value), baseline };
  });

  const contributions = ((contribsRes.data ?? []) as any[]);
  const investments = ((investmentsRes.data ?? []) as any[]);
  const monthlyIncome = round2(Number((snap as any).current_month_income ?? 0));
  const monthlySurplus = round2(monthlyIncome - Number((snap as any).current_month_expense ?? 0));
  const incomeEvent = (((snap as any).estimated_income_events ?? []) as any[])[0];
  const incomeDayOfMonth = incomeEvent?.date ? Number(String(incomeEvent.date).slice(8, 10)) : null;

  const wanted = String(args.goal_id ?? args.goal ?? "").trim().toLowerCase();
  const goals = ((goalsRes.data ?? []) as any[]).filter((goal) => {
    if (!wanted) return true;
    return String(goal.id).toLowerCase() === wanted
      || String(goal.name ?? "").toLowerCase().includes(wanted);
  });

  const plans = goals.map((goal) => {
    const goalContribs = contributions.filter((item) => item.goal_id === goal.id);
    const contributed = goalContribs.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const invested = investments
      .filter((item) => item.goal_id === goal.id)
      .reduce((sum, item) => sum + Number(item.current_value || 0), 0);
    // Ritmo: média mensal dos últimos 3 meses de aporte real.
    const recent = goalContribs.filter((item) => String(item.occurred_at) >= historyStart);
    const monthsInWindow = new Set(recent.map((item) => monthKey(String(item.occurred_at)))).size || 1;
    const pace = round2(recent.reduce((sum, item) => sum + Number(item.amount || 0), 0) / monthsInWindow);

    return buildGoalStrategy({
      goalName: goal.name ?? "Meta",
      targetAmount: Number(goal.target_amount || 0),
      achievedAmount: round2(contributed + invested),
      targetDate: goal.target_date ?? null,
      today,
      monthlyIncome,
      monthlySurplus,
      currentMonthlyPace: pace,
      incomeDayOfMonth,
      overspendCategories,
    });
  });

  return { formula_version: "goal_strategy.v1", month, plans };
}
