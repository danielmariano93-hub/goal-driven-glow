import { round2 } from "@/lib/engine/facts";
import type { CategoryGoalEvaluation } from "@/lib/engine/metrics";

type GoalLike = { id: string; kind?: string | null; target_amount: number; monthly_target?: number | null; donation_mode?: string | null };
type ContributionLike = { goal_id: string; amount: number; occurred_at: string };
type InvestmentLike = { goal_id?: string | null; current_value: number };

export type GoalOverview = {
  positiveImpactThisMonth: number;
  overallAttainmentPct: number;
  byType: { financial: number | null; category: number | null; donation: number | null };
};

const clampPct = (value: number) => Math.max(0, Math.min(100, round2(value)));
const mean = (values: Array<number | null>) => {
  const available = values.filter((value): value is number => value != null);
  return available.length ? round2(available.reduce((sum, value) => sum + value, 0) / available.length) : 0;
};

/**
 * Resumo único da tela de metas. O impacto positivo soma dinheiro efetivamente
 * guardado no mês e economia observada contra a linha de base das categorias.
 * Doação é progresso de propósito, não ganho financeiro, portanto não infla o indicador.
 */
export function computeGoalOverview(input: {
  goals: GoalLike[];
  contributions: ContributionLike[];
  investments: InvestmentLike[];
  categoryGoals: CategoryGoalEvaluation[];
  month: string;
}): GoalOverview {
  const contributionByGoal = new Map<string, number>();
  const contributionThisMonthByGoal = new Map<string, number>();
  for (const contribution of input.contributions) {
    contributionByGoal.set(contribution.goal_id, (contributionByGoal.get(contribution.goal_id) ?? 0) + Number(contribution.amount || 0));
    if (contribution.occurred_at.slice(0, 7) === input.month) {
      contributionThisMonthByGoal.set(contribution.goal_id, (contributionThisMonthByGoal.get(contribution.goal_id) ?? 0) + Number(contribution.amount || 0));
    }
  }
  const investmentByGoal = new Map<string, number>();
  for (const investment of input.investments) {
    if (!investment.goal_id) continue;
    investmentByGoal.set(investment.goal_id, (investmentByGoal.get(investment.goal_id) ?? 0) + Number(investment.current_value || 0));
  }

  const financialGoals = input.goals.filter((goal) => (goal.kind ?? "savings") === "savings");
  const donationGoals = input.goals.filter((goal) => goal.kind === "donation");
  const financial = financialGoals.length
    ? mean(financialGoals.map((goal) => clampPct(((contributionByGoal.get(goal.id) ?? 0) + (investmentByGoal.get(goal.id) ?? 0)) / Math.max(1, Number(goal.target_amount)) * 100)))
    : null;
  const category = input.categoryGoals.length
    ? mean(input.categoryGoals.map((goal) => goal.actualSpend <= goal.targetAmount ? 100 : clampPct(goal.targetAmount / Math.max(1, goal.actualSpend) * 100)))
    : null;
  const donation = donationGoals.length
    ? mean(donationGoals.map((goal) => {
      const monthlyTarget = goal.donation_mode === "fixed" ? Number(goal.monthly_target || 0) : Number(goal.target_amount || 0);
      return clampPct((contributionThisMonthByGoal.get(goal.id) ?? 0) / Math.max(1, monthlyTarget) * 100);
    }))
    : null;

  const savedThisMonth = financialGoals.reduce((sum, goal) => sum + (contributionThisMonthByGoal.get(goal.id) ?? 0), 0);
  const avoidedSpend = input.categoryGoals.reduce((sum, goal) => sum + Math.max(0, goal.baselineAmount - goal.actualSpend), 0);

  return {
    positiveImpactThisMonth: round2(savedThisMonth + avoidedSpend),
    overallAttainmentPct: mean([financial, category, donation]),
    byType: { financial, category, donation },
  };
}
