// Entradas do motor de estratégia de meta a partir dos dados já carregados na tela.
// Números vêm do ledger confirmado — nada é estimado.

import { behavioralMetricAmount, isRealMonthlyMovement, effectiveCategoryId, buildRefundAttribution, todayISO } from "@/lib/engine/facts";
import { buildGoalStrategy, type GoalStrategy } from "@/lib/engine/goalStrategy";
import { buildCategoryGoalStrategy, type CategoryGoalStrategy, type CategoryGoalHotspot } from "@/lib/engine/categoryGoalStrategy";
import type { CategoryGoalEvaluation } from "@/lib/engine/metrics";
import { buildMerchantResolver, type MerchantAliasRow } from "@/lib/engine/merchant";

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

type CategoryTxLike = TxLike & {
  merchant_name?: string | null;
  description?: string | null;
  origin?: string | null;
  movement_kind?: string | null;
};

/**
 * Plano determinístico de um teto de categoria.
 *
 * A distribuição por estabelecimento é MUTUAMENTE EXCLUSIVA: cada lançamento
 * pertence a exatamente uma identidade canônica de merchant, então variantes do
 * banco ("ON UBER TRIP H01/08", "PAY 99 TE 09/08") entram dentro da marca
 * ("Uber", "99") e nunca aparecem como linha separada — é isso que fazia a soma
 * dos percentuais passar de 100%.
 *
 * Numerador e denominador ficam na MESMA base (líquida de estorno), e o que
 * sobra fora do ranking vira "Outros" — nunca negativo.
 */
export function buildStrategyForCategoryGoal(
  evaluation: CategoryGoalEvaluation,
  txs: CategoryTxLike[],
  aliases: MerchantAliasRow[] = [],
): CategoryGoalStrategy {
  const attribution = buildRefundAttribution(txs as never);
  const resolver = buildMerchantResolver(aliases);
  const byMerchant = new Map<string, { label: string; amount: number; count: number; recurring: boolean }>();
  const byRecurring = new Map<string, number>();
  let total = 0;

  for (const tx of txs) {
    if (String(tx.status ?? "confirmed") !== "confirmed") continue;
    if (effectiveCategoryId(tx as never, attribution) !== evaluation.goal.category_id) continue;
    if (tx.occurred_at < evaluation.period.start || tx.occurred_at > evaluation.period.end) continue;

    const refundKind = String(tx.movement_kind ?? "") === "refund";
    // Base única: estorno abate o gasto, no numerador e no denominador.
    const value = refundKind
      ? behavioralMetricAmount(tx as never, "expense")
      : tx.type === "expense" && isRealMonthlyMovement(tx as never)
        ? Number(tx.amount || 0)
        : 0;
    if (value === 0) continue;

    const raw = tx.merchant_name || tx.description || "";
    const resolution = resolver.resolve(raw);
    const key = resolution?.key ?? `raw:${String(raw).trim().toLowerCase() || "sem_descricao"}`;
    const label = resolution?.label ?? (String(raw).trim() || "Sem descrição");
    const isRecurring = String(tx.origin ?? "") === "recurring";

    const current = byMerchant.get(key) ?? { label, amount: 0, count: 0, recurring: false };
    byMerchant.set(key, {
      label: current.label,
      amount: current.amount + value,
      count: current.count + (value > 0 ? 1 : 0),
      recurring: current.recurring || isRecurring,
    });
    total += value;

    if (value > 0 && isRecurring) {
      byRecurring.set(label, (byRecurring.get(label) ?? 0) + value);
    }
  }

  const categoryTotal = round2(Math.max(0, total));
  const denominator = categoryTotal > 0 ? categoryTotal : 1;
  const ranked = [...byMerchant.values()]
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const hotspots: CategoryGoalHotspot[] = ranked.slice(0, 4).map((item) => ({
    label: item.label,
    amount: round2(item.amount),
    sharePct: round2((item.amount / denominator) * 100),
    count: item.count,
    recurring: item.recurring,
  }));

  const hotspotsSum = round2(hotspots.reduce((sum, item) => sum + item.amount, 0));
  const othersAmount = round2(Math.max(0, categoryTotal - hotspotsSum));
  const others = {
    amount: othersAmount,
    sharePct: categoryTotal > 0 ? round2((othersAmount / denominator) * 100) : 0,
  };

  const recurringInPeriod = [...byRecurring.entries()]
    .map(([label, amount]) => ({ label, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  return buildCategoryGoalStrategy({ evaluation, hotspots, others, categoryTotal, recurringInPeriod });
}
