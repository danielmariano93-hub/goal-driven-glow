// FinancialPlanner — builds concrete financial plans from a declared objective.
// Uses UserProfile.savings_capacity to project timelines.
// deno-lint-ignore-file no-explicit-any
import type { UserProfile } from "./UserProfile.ts";

export type PlanObjective = {
  goal: string;
  target_amount: number;
  deadline_months?: number;
  monthly_contribution?: number;
  constraints?: { max_monthly?: number };
};

export type Milestone = { month: number; label: string; accumulated: number };

export type FinancialPlan = {
  goal: string;
  target_amount: number;
  monthly_contribution: number;
  months_needed: number;
  feasibility: "confortavel" | "apertado" | "inviavel";
  milestones: Milestone[];
  projections: { total: number; interest_assumption: number };
  impact: { pct_of_income: number; pct_of_savings: number };
  recommendations: string[];
};

export function buildPlan(profile: UserProfile, obj: PlanObjective): FinancialPlan {
  const income = profile.estimated_income ?? 0;
  const savings = Math.max(0, profile.savings_capacity ?? 0);
  const maxMonthly = obj.constraints?.max_monthly ?? Infinity;

  let monthly = obj.monthly_contribution
    ?? (obj.deadline_months ? Math.ceil(obj.target_amount / obj.deadline_months) : Math.max(100, Math.floor(savings * 0.5)));
  monthly = Math.min(monthly, maxMonthly);

  const monthsNeeded = monthly > 0 ? Math.ceil(obj.target_amount / monthly) : 999;

  const pctIncome = income > 0 ? monthly / income : 0;
  const pctSavings = savings > 0 ? monthly / savings : 1;

  const feasibility: FinancialPlan["feasibility"] =
    monthly <= savings * 0.7 ? "confortavel" :
    monthly <= savings * 1.1 ? "apertado" : "inviavel";

  const milestones: Milestone[] = [];
  const quarters = Math.max(1, Math.floor(monthsNeeded / 4));
  for (let i = quarters; i <= monthsNeeded; i += quarters) {
    milestones.push({ month: i, label: `${i}º mês`, accumulated: Math.min(obj.target_amount, monthly * i) });
  }
  if (milestones[milestones.length - 1]?.month !== monthsNeeded) {
    milestones.push({ month: monthsNeeded, label: "Meta batida", accumulated: obj.target_amount });
  }

  const recs: string[] = [];
  if (feasibility === "inviavel") recs.push("Ajustar o valor da meta ou aumentar o prazo.");
  if (feasibility === "apertado") recs.push("Reveja assinaturas e categorias com maior peso para liberar folga.");
  if (feasibility === "confortavel") recs.push("Automatize o aporte no dia seguinte ao recebimento.");
  if (income > 0 && pctIncome > 0.3) recs.push("Aporte acima de 30% da renda: considere ampliar o prazo.");

  return {
    goal: obj.goal,
    target_amount: obj.target_amount,
    monthly_contribution: monthly,
    months_needed: monthsNeeded,
    feasibility,
    milestones,
    projections: { total: monthly * monthsNeeded, interest_assumption: 0 },
    impact: { pct_of_income: round(pctIncome, 3), pct_of_savings: round(pctSavings, 3) },
    recommendations: recs,
  };
}

function round(n: number, d = 2) { const p = 10 ** d; return Math.round(n * p) / p; }
