// Entradas do motor de estratégia de meta a partir dos dados já carregados na tela.
// Números vêm do ledger confirmado — nada é estimado.

import { behavioralMetricAmount, isRealMonthlyMovement, effectiveCategoryId, buildRefundAttribution, todayISO } from "@/lib/engine/facts";
import { buildGoalStrategy, type GoalStrategy } from "@/lib/engine/goalStrategy";
import { buildCategoryGoalStrategy, type CategoryGoalStrategy, type CategoryGoalHotspot } from "@/lib/engine/categoryGoalStrategy";
import type { CategoryGoalEvaluation } from "@/lib/engine/metrics";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

type TxLike = {
  occurred_at: string;
  type?: string | null;
  status?: string | null;
  amount: number;
  category_id?: string | null;
};

function shiftMonth(ym: string, delta: number): string {
  const [year, month] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type StrategyBaseInputs = {
  monthlyIncome: number;
  monthlySurplus: number;
  incomeDayOfMonth: number | null;
  overspendCategories: Array<{ name: string; monthlyAvg: number; baseline: number }>;
};

/** Renda, sobra e categorias acima da linha de base pessoal do mês corrente. */
export function buildStrategyBase(
  txs: TxLike[],
  categoryNameById: Record<string, string>,
): StrategyBaseInputs {
  const today = todayISO();
  const month = today.slice(0, 7);
  const windowStart = `${shiftMonth(month, -3)}-01`;

  let income = 0;
  let expense = 0;
  let incomeDay: number | null = null;
  let biggestIncome = 0;
  const currentByCategory = new Map<string, number>();
  const priorMonths = new Map<string, Map<string, number>>();

  for (const tx of txs) {
    if (String(tx.status ?? "confirmed") !== "confirmed") continue;
    if (!isRealMonthlyMovement(tx as never)) continue;
    const ym = tx.occurred_at.slice(0, 7);
    if (ym === month) {
      const inValue = behavioralMetricAmount(tx as never, "income");
      if (inValue > 0) {
        income += inValue;
        if (inValue > biggestIncome) {
          biggestIncome = inValue;
          incomeDay = Number(tx.occurred_at.slice(8, 10));
        }
      }
    }
    const outValue = behavioralMetricAmount(tx as never, "expense");
    if (!(outValue > 0)) continue;
    if (ym === month) {
      expense += outValue;
      const key = effectiveCategoryId(tx as never) ?? "sem_categoria";
      currentByCategory.set(key, (currentByCategory.get(key) ?? 0) + outValue);
    } else if (tx.occurred_at >= windowStart) {
      const key = effectiveCategoryId(tx as never) ?? "sem_categoria";
      const bucket = priorMonths.get(ym) ?? new Map<string, number>();
      bucket.set(key, (bucket.get(key) ?? 0) + outValue);
      priorMonths.set(ym, bucket);
    }
  }

  const priorByCategory = new Map<string, number[]>();
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
    return { name: categoryNameById[key] ?? "Sem categoria", monthlyAvg: round2(value), baseline };
  });

  return {
    monthlyIncome: round2(income),
    monthlySurplus: round2(income - expense),
    incomeDayOfMonth: incomeDay,
    overspendCategories,
  };
}

/** Plano determinístico de uma meta específica. */
export function buildStrategyForGoal(
  goal: { name: string; target_amount: number | string; target_date?: string | null },
  achievedAmount: number,
  contributions: Array<{ amount: number | string; occurred_at: string }>,
  base: StrategyBaseInputs,
): GoalStrategy {
  const today = todayISO();
  const windowStart = `${shiftMonth(today.slice(0, 7), -3)}-01`;
  const recent = contributions.filter((item) => item.occurred_at >= windowStart);
  const monthsInWindow = new Set(recent.map((item) => item.occurred_at.slice(0, 7))).size || 1;
  const pace = round2(recent.reduce((sum, item) => sum + Number(item.amount || 0), 0) / monthsInWindow);

  return buildGoalStrategy({
    goalName: goal.name,
    targetAmount: Number(goal.target_amount || 0),
    achievedAmount: round2(achievedAmount),
    targetDate: goal.target_date ?? null,
    today,
    monthlyIncome: base.monthlyIncome,
    monthlySurplus: base.monthlySurplus,
    currentMonthlyPace: pace,
    incomeDayOfMonth: base.incomeDayOfMonth,
    overspendCategories: base.overspendCategories,
  });
}
