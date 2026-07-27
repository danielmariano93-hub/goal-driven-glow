// Deterministic weekly/monthly advisor reviews.
// Financial facts remain sourced from UserProfile and existing goals/contributions.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildPlan } from "./FinancialPlanner.ts";
import { loadProfile, type UserProfile } from "./UserProfile.ts";
import { remember } from "./MemoryStore.ts";

export type AdvisorAction = {
  key: string;
  title: string;
  detail: string;
  status: "pending" | "in_progress" | "done" | "dismissed";
  priority: number;
  route: string;
  evidence: Record<string, unknown>;
};

export type AdvisorReviewPayload = {
  period_kind: "weekly" | "monthly";
  period_start: string;
  period_end: string;
  summary: {
    headline: string;
    explanation: string;
    indicators: Record<string, number | null>;
    limitations: string[];
  };
  actions: AdvisorAction[];
  formula_version: "advisor.review.v1";
};

type GoalRow = {
  id: string;
  name: string;
  target_amount: number;
  target_date?: string | null;
};

const DAY = 86_400_000;

function localDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function period(kind: "weekly" | "monthly", now = new Date()): { start: string; end: string } {
  const today = new Date(`${localDate(now)}T12:00:00Z`);
  if (kind === "monthly") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 12));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  const weekday = (today.getUTCDay() + 6) % 7;
  const start = new Date(today.getTime() - weekday * DAY);
  const end = new Date(start.getTime() + 6 * DAY);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function reviewHeadline(profile: UserProfile): { headline: string; explanation: string } {
  const rate = Number(profile.indicators.savings_rate ?? 0);
  if (rate < 0) {
    return {
      headline: "O mês pede uma correção de rota",
      explanation: "As despesas médias registradas estão acima das entradas. O plano prioriza recuperar margem antes de ampliar metas.",
    };
  }
  if (rate < 0.1) {
    return {
      headline: "Seu orçamento está equilibrado, mas com pouca folga",
      explanation: "Há equilíbrio nos registros, porém pequenas oscilações podem consumir a margem. O foco é criar proteção.",
    };
  }
  return {
    headline: "Você está construindo margem financeira",
    explanation: "As entradas médias cobrem os gastos registrados. O plano concentra a folga nas prioridades escolhidas.",
  };
}

function buildActions(
  profile: UserProfile,
  goal: { row: GoalRow; current: number } | null,
): AdvisorAction[] {
  const actions: AdvisorAction[] = [];
  const savingsRate = Number(profile.indicators.savings_rate ?? 0);
  const top = profile.top_categories[0];

  if (savingsRate < 0 && top) {
    actions.push({
      key: "review-top-category",
      title: `Revisar gastos em ${top.category}`,
      detail: `Essa categoria representa ${Math.round(top.share * 100)}% dos gastos observados. Revise os lançamentos e defina um limite realista.`,
      status: "pending",
      priority: 300,
      route: "/app/lancamentos",
      evidence: { category: top.category, share: top.share, total: top.total },
    });
  }

  if (goal && goal.row.target_amount > goal.current) {
    const deadlineMonths = goal.row.target_date
      ? Math.max(1, Math.ceil((new Date(goal.row.target_date).getTime() - Date.now()) / (30 * DAY)))
      : undefined;
    const plan = buildPlan(profile, {
      goal: goal.row.name,
      target_amount: Math.max(0, goal.row.target_amount - goal.current),
      deadline_months: deadlineMonths,
    });
    actions.push({
      key: `goal:${goal.row.id}`,
      title: `Avançar na meta "${goal.row.name}"`,
      detail: `Referência atual: R$ ${plan.monthly_contribution.toFixed(2)} por mês por aproximadamente ${plan.months_needed} mês(es).`,
      status: "pending",
      priority: 220,
      route: "/app/metas",
      evidence: {
        goal_id: goal.row.id,
        remaining: Math.max(0, goal.row.target_amount - goal.current),
        monthly_contribution: plan.monthly_contribution,
        months_needed: plan.months_needed,
        feasibility: plan.feasibility,
      },
    });
  }

  if (top?.share && top.share > 0.4 && !actions.some((action) => action.key === "review-top-category")) {
    actions.push({
      key: "diversify-spending",
      title: "Entender a concentração dos gastos",
      detail: `${Math.round(top.share * 100)}% das despesas observadas estão em ${top.category}. Confirme se isso é esperado ou pontual.`,
      status: "pending",
      priority: 180,
      route: "/app/relatorios",
      evidence: { category: top.category, share: top.share, total: top.total },
    });
  }

  actions.push({
    key: "weekly-checkin",
    title: "Fazer uma revisão de cinco minutos",
    detail: "Confira lançamentos recentes, contas próximas e o progresso das metas. Corrija o que estiver incompleto.",
    status: "pending",
    priority: 100,
    route: "/app",
    evidence: { profile_computed_at: profile.computed_at },
  });

  return actions.sort((a, b) => b.priority - a.priority).slice(0, 4);
}

export function buildAdvisorReview(
  profile: UserProfile,
  goal: { row: GoalRow; current: number } | null,
  kind: "weekly" | "monthly",
  now = new Date(),
): AdvisorReviewPayload {
  const window = period(kind, now);
  const headline = reviewHeadline(profile);
  return {
    period_kind: kind,
    period_start: window.start,
    period_end: window.end,
    summary: {
      headline: headline.headline,
      explanation: headline.explanation,
      indicators: {
        estimated_income: profile.estimated_income,
        savings_capacity: profile.savings_capacity,
        net_worth: profile.net_worth,
        savings_rate: Number(profile.indicators.savings_rate ?? 0),
        months_observed: Number(profile.indicators.months_observed ?? 0),
      },
      limitations: [
        "A revisão usa apenas informações registradas no Meu Nino.",
        "Valores previstos não representam garantia de resultado.",
      ],
    },
    actions: buildActions(profile, goal),
    formula_version: "advisor.review.v1",
  };
}

export async function generateAdvisorReviews(
  sb: SupabaseClient,
  user_id: string,
): Promise<{ weekly: number; monthly: number }> {
  const profile = await loadProfile(sb, user_id);

  const { data: goalsData } = await sb.from("goals")
    .select("id,name,target_amount,target_date")
    .eq("user_id", user_id)
    .order("created_at", { ascending: true })
    .limit(20);
  const goals = ((goalsData as Record<string, unknown>[] | null) ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    target_amount: Number(row.target_amount) || 0,
    target_date: typeof row.target_date === "string" ? row.target_date : null,
  }));

  let selectedGoal: { row: GoalRow; current: number } | null = null;
  if (goals.length > 0) {
    const { data: contributions } = await sb.from("goal_contributions")
      .select("goal_id,amount")
      .in("goal_id", goals.map((goal) => goal.id));
    const totals = new Map<string, number>();
    for (const item of (contributions as Record<string, unknown>[] | null) ?? []) {
      const id = String(item.goal_id);
      totals.set(id, (totals.get(id) ?? 0) + Number(item.amount || 0));
    }
    const open = goals
      .map((row) => ({ row, current: totals.get(row.id) ?? 0 }))
      .filter((goal) => goal.current < goal.row.target_amount)
      .sort((a, b) => (a.row.target_date ?? "9999").localeCompare(b.row.target_date ?? "9999"));
    selectedGoal = open[0] ?? null;
  }

  const outputs = {
    weekly: buildAdvisorReview(profile, selectedGoal, "weekly"),
    monthly: buildAdvisorReview(profile, selectedGoal, "monthly"),
  };

  const counts = { weekly: 0, monthly: 0 };
  for (const review of [outputs.weekly, outputs.monthly]) {
    const { data: existingReview } = await sb.from("advisor_reviews")
      .select("actions,status")
      .eq("user_id", user_id)
      .eq("period_kind", review.period_kind)
      .eq("period_start", review.period_start)
      .maybeSingle();

    const existingActions = Array.isArray((existingReview as Record<string, unknown> | null)?.actions)
      ? (existingReview as { actions: AdvisorAction[] }).actions
      : [];
    const previousStatus = new Map(existingActions.map((action) => [action.key, action.status]));
    const mergedActions = review.actions.map((action) => ({
      ...action,
      status: previousStatus.get(action.key) ?? action.status,
    }));

    const { error } = await sb.from("advisor_reviews").upsert({
      user_id,
      period_kind: review.period_kind,
      period_start: review.period_start,
      period_end: review.period_end,
      summary: review.summary,
      actions: mergedActions,
      status: mergedActions.every((action) => ["done", "dismissed"].includes(action.status))
        ? "completed"
        : "active",
      formula_version: review.formula_version,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,period_kind,period_start" });

    if (!error) {
      counts[review.period_kind]++;
      await sb.from("pending_proactive_suggestions").upsert({
        user_id,
        kind: `advisor_review_${review.period_kind}`,
        severity: "info",
        title: review.period_kind === "weekly"
          ? "Sua revisão semanal está pronta"
          : "Seu fechamento mensal está pronto",
        body: review.summary.explanation,
        action: { route: "/app/assessor/acompanhamento" },
        evidence: {
          period_start: review.period_start,
          period_end: review.period_end,
          formula_version: review.formula_version,
        },
        channel_ready: "app",
        dedup_key: `advisor_review:${review.period_kind}:${review.period_start}`,
        expires_at: new Date(Date.now() + 14 * DAY).toISOString(),
        status: "pending",
      }, {
        onConflict: "user_id,dedup_key",
        ignoreDuplicates: true,
      });
    }

    await remember(sb, {
      user_id,
      kind: "advisor_review",
      key: `${review.period_kind}:${review.period_start}`,
      value: {
        summary: review.summary,
        actions: mergedActions.map((action) => ({
          key: action.key,
          title: action.title,
          status: action.status,
        })),
        period_end: review.period_end,
      },
      confidence: 1,
      source: "inferred",
      expires_at: new Date(Date.now() + 180 * DAY).toISOString(),
    });
  }

  return counts;
}
