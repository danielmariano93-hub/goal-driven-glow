// Period-aware advisor reviews for Meu Nino.
// Weekly and monthly reviews are calculated from their own transaction windows;
// they never reuse the same generic profile summary.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadProfile } from "./UserProfile.ts";
import { remember } from "./MemoryStore.ts";
import { periodReviewKey } from "../../intelligence/logicalDedup.ts";
import { fetchAllPages } from "../../derived/pagedSelect.ts";


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
    period_label: string;
    highlights: string[];
    indicators: Record<string, number | null>;
    comparison: Record<string, number | null>;
    limitations: string[];
  };
  actions: AdvisorAction[];
  formula_version: "advisor.review.v2.period-aware";
};

export const REVIEW_MIN_TRANSACTIONS = 20;
export const REVIEW_MIN_MONTHS_OBSERVED = 1;
const DAY = 86_400_000;
const FIXED_CATEGORY_NAMES = new Set([
  "moradia",
  "aluguel",
  "condominio",
  "condomínio",
  "dividas e emprestimos",
  "dívidas e empréstimos",
  "impostos",
  "investimentos",
  "transferencias",
  "transferências",
]);

type TxRow = {
  id: string;
  amount: number | string;
  type: "income" | "expense";
  occurred_at: string;
  description: string | null;
  friendly_description?: string | null;
  category_id: string | null;
  movement_kind?: string | null;
  transfer_group_id?: string | null;
  settles_card_id?: string | null;
  split_transaction_role?: string | null;
};

type GoalRow = {
  id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
};

type Window = { start: string; end: string; previousStart: string; previousEnd: string };
type CategoryFact = {
  id: string | null;
  name: string;
  current: number;
  previous: number;
  delta: number;
  share: number;
  fixed: boolean;
  transactions: Array<{ id: string; description: string; amount: number; occurred_at: string }>;
};

type PeriodFacts = {
  kind: "weekly" | "monthly";
  window: Window;
  income: number;
  expense: number;
  net: number;
  previousIncome: number;
  previousExpense: number;
  previousNet: number;
  expenseChangePct: number | null;
  savingsRate: number | null;
  uncategorizedCount: number;
  fixedExpense: number;
  flexibleExpense: number;
  categories: CategoryFact[];
  transactionCount: number;
};

export type ReviewReadiness = {
  eligible: boolean;
  transactions_90d: number;
  months_observed: number;
  missing: string[];
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function localDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function reviewWindow(kind: "weekly" | "monthly", now = new Date()): Window {
  const today = new Date(`${localDate(now)}T12:00:00Z`);
  if (kind === "monthly") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 12));
    const previousStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1, 12));
    const previousEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0, 12));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      previousStart: previousStart.toISOString().slice(0, 10),
      previousEnd: previousEnd.toISOString().slice(0, 10),
    };
  }

  const weekday = (today.getUTCDay() + 6) % 7;
  const start = new Date(today.getTime() - weekday * DAY);
  const end = new Date(start.getTime() + 6 * DAY);
  const previousStart = new Date(start.getTime() - 7 * DAY);
  const previousEnd = new Date(start.getTime() - DAY);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    previousStart: previousStart.toISOString().slice(0, 10),
    previousEnd: previousEnd.toISOString().slice(0, 10),
  };
}

function normalizeLabel(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isBehavioralTransaction(row: TxRow): boolean {
  if (!row || !["income", "expense"].includes(row.type)) return false;
  if ((row.movement_kind ?? "transaction") !== "transaction") return false;
  if (row.transfer_group_id || row.settles_card_id) return false;
  if (["reimbursement", "settlement"].includes(String(row.split_transaction_role ?? ""))) return false;
  return true;
}

export function evaluateReadiness(transactions90d: number, monthsObserved: number): ReviewReadiness {
  const missing: string[] = [];
  if (transactions90d < REVIEW_MIN_TRANSACTIONS) {
    missing.push(`Registrar ao menos ${REVIEW_MIN_TRANSACTIONS} lançamentos nos últimos 90 dias (você tem ${transactions90d}).`);
  }
  if (monthsObserved < REVIEW_MIN_MONTHS_OBSERVED) {
    missing.push("Ter ao menos um mês com lançamentos confirmados.");
  }
  return {
    eligible: missing.length === 0,
    transactions_90d: transactions90d,
    months_observed: monthsObserved,
    missing,
  };
}

function computeFacts(
  kind: "weekly" | "monthly",
  window: Window,
  rows: TxRow[],
  categoryNames: Map<string, string>,
): PeriodFacts {
  const valid = rows.filter(isBehavioralTransaction);
  const current = valid.filter((row) => row.occurred_at >= window.start && row.occurred_at <= window.end);
  const previous = valid.filter((row) => row.occurred_at >= window.previousStart && row.occurred_at <= window.previousEnd);

  const sum = (list: TxRow[], type: "income" | "expense") => list
    .filter((row) => row.type === type)
    .reduce((total, row) => total + Math.abs(Number(row.amount) || 0), 0);

  const income = sum(current, "income");
  const expense = sum(current, "expense");
  const previousIncome = sum(previous, "income");
  const previousExpense = sum(previous, "expense");
  const categories = new Map<string, CategoryFact>();

  for (const row of current.filter((item) => item.type === "expense")) {
    const key = row.category_id ?? "uncategorized";
    const name = row.category_id ? (categoryNames.get(row.category_id) ?? "Outra categoria") : "Sem categoria";
    const existing = categories.get(key) ?? {
      id: row.category_id,
      name,
      current: 0,
      previous: 0,
      delta: 0,
      share: 0,
      fixed: FIXED_CATEGORY_NAMES.has(normalizeLabel(name)),
      transactions: [],
    };
    existing.current += Math.abs(Number(row.amount) || 0);
    existing.transactions.push({
      id: row.id,
      description: row.friendly_description || row.description || "Lançamento",
      amount: Math.abs(Number(row.amount) || 0),
      occurred_at: row.occurred_at,
    });
    categories.set(key, existing);
  }

  for (const row of previous.filter((item) => item.type === "expense")) {
    const key = row.category_id ?? "uncategorized";
    const name = row.category_id ? (categoryNames.get(row.category_id) ?? "Outra categoria") : "Sem categoria";
    const existing = categories.get(key) ?? {
      id: row.category_id,
      name,
      current: 0,
      previous: 0,
      delta: 0,
      share: 0,
      fixed: FIXED_CATEGORY_NAMES.has(normalizeLabel(name)),
      transactions: [],
    };
    existing.previous += Math.abs(Number(row.amount) || 0);
    categories.set(key, existing);
  }

  const categoryFacts = [...categories.values()].map((category) => ({
    ...category,
    current: round2(category.current),
    previous: round2(category.previous),
    delta: round2(category.current - category.previous),
    share: expense > 0 ? category.current / expense : 0,
    transactions: category.transactions.sort((a, b) => b.amount - a.amount).slice(0, 5),
  })).sort((a, b) => b.current - a.current);

  const fixedExpense = categoryFacts.filter((item) => item.fixed).reduce((sumValue, item) => sumValue + item.current, 0);
  const flexibleExpense = Math.max(0, expense - fixedExpense);
  const expenseChangePct = previousExpense > 0 ? ((expense - previousExpense) / previousExpense) * 100 : null;

  return {
    kind,
    window,
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    previousIncome: round2(previousIncome),
    previousExpense: round2(previousExpense),
    previousNet: round2(previousIncome - previousExpense),
    expenseChangePct: expenseChangePct == null ? null : round2(expenseChangePct),
    savingsRate: income > 0 ? round2((income - expense) / income) : null,
    uncategorizedCount: current.filter((row) => row.type === "expense" && !row.category_id).length,
    fixedExpense: round2(fixedExpense),
    flexibleExpense: round2(flexibleExpense),
    categories: categoryFacts,
    transactionCount: current.length,
  };
}

function periodLabel(kind: "weekly" | "monthly", window: Window): string {
  if (kind === "weekly") return `Semana de ${window.start} a ${window.end}`;
  const date = new Date(`${window.start}T12:00:00Z`);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function buildHeadline(facts: PeriodFacts): { headline: string; explanation: string } {
  const label = facts.kind === "weekly" ? "semana" : "mês";
  if (facts.transactionCount === 0) {
    return {
      headline: `Ainda não há movimentações nesta ${label}`,
      explanation: `A revisão considera apenas lançamentos confirmados entre ${facts.window.start} e ${facts.window.end}.`,
    };
  }
  if (facts.net < 0) {
    return {
      headline: `O consumo superou a renda em ${formatBRL(Math.abs(facts.net))} nesta ${label}`,
      explanation: `Entraram ${formatBRL(facts.income)} e o consumo somou ${formatBRL(facts.expense)}. Isso é o resultado do período, não o saldo atual das suas contas; os próximos passos focam apenas alavancas ajustáveis.`,
    };
  }
  return {
    headline: `A renda superou o consumo em ${formatBRL(facts.net)} nesta ${label}`,
    explanation: `Entraram ${formatBRL(facts.income)} e o consumo somou ${formatBRL(facts.expense)}. A revisão transforma esse resultado em comparações e próximos passos concretos.`,
  };
}

function buildHighlights(facts: PeriodFacts): string[] {
  const highlights: string[] = [];
  if (facts.income > 0 && facts.savingsRate != null) {
    const retained = Math.round(facts.savingsRate * 100);
    highlights.push(retained >= 0
      ? `A cada R$ 100 de renda, ${formatBRL(retained)} permaneceram livres neste período.`
      : `A cada R$ 100 de renda, o consumo passou ${formatBRL(Math.abs(retained))} do que entrou.`
    );
  }
  // Comparação percentual só é honesta quando o período anterior tem base
  // suficiente. Com base ínfima, "-100%" engana: dizemos o valor absoluto.
  const comparableBase = facts.previousExpense >= 50;
  if (facts.expenseChangePct != null && comparableBase) {
    const direction = facts.expenseChangePct >= 0 ? "aumentaram" : "diminuíram";
    highlights.push(`As despesas ${direction} ${Math.abs(Math.round(facts.expenseChangePct))}% em relação ao período anterior (${formatBRL(facts.previousExpense)}).`);
  } else if (facts.previousExpense > 0) {
    highlights.push(`O período anterior teve pouca movimentação (${formatBRL(facts.previousExpense)}), então a comparação percentual ainda não é confiável. Agora foram ${formatBRL(facts.expense)}.`);
  } else {
    highlights.push("Ainda não há um período anterior comparável com despesas registradas.");
  }

  const top = facts.categories[0];
  if (top) {
    if (top.fixed) {
      highlights.push(`${top.name} representa ${Math.round(top.share * 100)}% das despesas, mas parece majoritariamente fixa; o Nino não sugeriu um corte automático.`);
    } else {
      highlights.push(`${top.name} foi a maior categoria ajustável, com ${formatBRL(top.current)} no período.`);
    }
  }

  const biggestIncrease = facts.categories
    .filter((category) => category.delta > 0 && category.name !== "Sem categoria")
    .sort((a, b) => b.delta - a.delta)[0];
  if (biggestIncrease && biggestIncrease !== top) {
    highlights.push(`${biggestIncrease.name} foi a maior aceleração: ${formatBRL(biggestIncrease.delta)} acima do período anterior.`);
  }

  const adjustable = facts.categories
    .filter((category) => !category.fixed && category.name !== "Sem categoria")
    .sort((a, b) => b.current - a.current)[0];
  if (adjustable && adjustable.current >= 100) {
    highlights.push(`Uma redução de 10% em ${adjustable.name} liberaria cerca de ${formatBRL(adjustable.current * 0.1)}, sem mexer nas despesas classificadas como fixas.`);
  }

  if (facts.uncategorizedCount > 0) {
    highlights.push(`${facts.uncategorizedCount} lançamento(s) ainda estão sem categoria e reduzem a precisão da análise.`);
  }
  if (facts.fixedExpense > 0) {
    highlights.push(`${formatBRL(facts.fixedExpense)} foram classificados como despesas possivelmente fixas e ${formatBRL(facts.flexibleExpense)} como ajustáveis.`);
  }
  return highlights.slice(0, 5);
}

function buildActions(
  facts: PeriodFacts,
  goal: { row: GoalRow; current: number } | null,
): AdvisorAction[] {
  const actions: AdvisorAction[] = [];
  const scope = `${facts.kind}:${facts.window.start}`;

  if (facts.uncategorizedCount > 0) {
    actions.push({
      key: `${scope}:categorize`,
      title: `Categorizar ${facts.uncategorizedCount} lançamento(s) do período`,
      detail: "Esses itens estão fora da leitura por categoria. Comece por eles antes de decidir onde reduzir gastos.",
      status: "pending",
      priority: 320,
      route: `/app/lancamentos?status=uncategorized&from=${facts.window.start}&to=${facts.window.end}`,
      evidence: { count: facts.uncategorizedCount, period_start: facts.window.start, period_end: facts.window.end },
    });
  }

  const adjustable = facts.categories
    .filter((category) => !category.fixed && category.name !== "Sem categoria" && category.current >= 50)
    .sort((a, b) => (b.delta > 0 ? b.delta : b.current) - (a.delta > 0 ? a.delta : a.current))[0];

  if (adjustable) {
    const increase = Math.max(0, adjustable.delta);
    const reviewAmount = increase > 0 ? increase : adjustable.current;
    const conservativeImpact = round2(Math.min(reviewAmount, adjustable.current * 0.15));
    const examples = adjustable.transactions.slice(0, 3)
      .map((tx) => `${tx.description} (${formatBRL(tx.amount)})`)
      .join(", ");
    actions.push({
      key: `${scope}:category:${adjustable.id ?? normalizeLabel(adjustable.name)}`,
      title: increase > 0
        ? `Entender os ${formatBRL(increase)} a mais em ${adjustable.name}`
        : `Revisar os maiores gastos em ${adjustable.name}`,
      detail: `${adjustable.name} somou ${formatBRL(adjustable.current)}. ${increase > 0 ? `No período anterior foram ${formatBRL(adjustable.previous)}. ` : ""}${examples ? `Maiores itens: ${examples}. ` : ""}Uma redução conservadora de 15% nessa parte ajustável representaria cerca de ${formatBRL(conservativeImpact)}, mas só depois de confirmar quais itens são realmente dispensáveis.`,
      status: "pending",
      priority: 260,
      route: `/app/lancamentos?category=${encodeURIComponent(adjustable.name)}&from=${facts.window.start}&to=${facts.window.end}`,
      evidence: {
        category: adjustable.name,
        current: adjustable.current,
        previous: adjustable.previous,
        delta: adjustable.delta,
        estimated_impact: conservativeImpact,
        transaction_ids: adjustable.transactions.map((tx) => tx.id),
      },
    });
  }

  if (goal && goal.row.target_amount > goal.current) {
    const remaining = Math.max(0, goal.row.target_amount - goal.current);
    const daysLeft = goal.row.target_date
      ? Math.max(1, Math.ceil((new Date(goal.row.target_date).getTime() - Date.now()) / DAY))
      : 365;
    const monthlyNeeded = round2(remaining / Math.max(1, daysLeft / 30));
    const periodContribution = facts.kind === "weekly" ? round2(monthlyNeeded / 4.33) : monthlyNeeded;
    const available = Math.max(0, facts.net);
    const feasibleNow = available >= periodContribution;
    actions.push({
      key: `${scope}:goal:${goal.row.id}`,
      title: feasibleNow
        ? `Separar ${formatBRL(periodContribution)} para “${goal.row.name}”`
        : `Recalibrar o ritmo da meta “${goal.row.name}”`,
      detail: feasibleNow
        ? `Para o prazo atual, a referência é ${formatBRL(monthlyNeeded)} por mês. Neste ${facts.kind === "weekly" ? "ciclo semanal" : "mês"}, o saldo registrado comporta ${formatBRL(periodContribution)}.`
        : `A meta pede cerca de ${formatBRL(monthlyNeeded)} por mês, mas o saldo deste período foi ${formatBRL(facts.net)}. Revise prazo ou valor antes de assumir um aporte inviável.`,
      status: "pending",
      priority: 220,
      route: "/app/metas",
      evidence: {
        goal_id: goal.row.id,
        remaining,
        days_left: daysLeft,
        monthly_needed: monthlyNeeded,
        period_contribution: periodContribution,
        available_in_period: available,
        feasible_now: feasibleNow,
      },
    });
  }

  return actions.sort((a, b) => b.priority - a.priority).slice(0, 4);
}

function buildReview(
  facts: PeriodFacts,
  goal: { row: GoalRow; current: number } | null,
  netWorth: number,
): AdvisorReviewPayload {
  const headline = buildHeadline(facts);
  return {
    period_kind: facts.kind,
    period_start: facts.window.start,
    period_end: facts.window.end,
    summary: {
      headline: headline.headline,
      explanation: headline.explanation,
      period_label: periodLabel(facts.kind, facts.window),
      highlights: buildHighlights(facts),
      indicators: {
        income: facts.income,
        expense: facts.expense,
        net: facts.net,
        savings_rate: facts.savingsRate,
        previous_expense: facts.previousExpense,
        expense_change_pct: facts.expenseChangePct,
        uncategorized_count: facts.uncategorizedCount,
        fixed_expense: facts.fixedExpense,
        flexible_expense: facts.flexibleExpense,
        net_worth: round2(netWorth),
      },
      comparison: {
        previous_income: facts.previousIncome,
        previous_expense: facts.previousExpense,
        previous_net: facts.previousNet,
        expense_change_pct: facts.expenseChangePct,
      },
      limitations: [
        "A revisão usa apenas lançamentos confirmados no Meu Nino e exclui transferências, pagamento de fatura e movimentos técnicos.",
        "Resultado do período significa renda menos consumo; não representa o saldo bancário disponível hoje.",
        "A classificação entre gasto fixo e ajustável é uma aproximação; confirme os lançamentos antes de tomar decisões.",
        "Estimativas de economia não são garantia de resultado.",
      ],
    },
    actions: buildActions(facts, goal),
    formula_version: "advisor.review.v2.period-aware",
  };
}

async function loadSelectedGoal(sb: SupabaseClient, userId: string): Promise<{ row: GoalRow; current: number } | null> {
  const { data: goalsData, error: goalsError } = await sb.from("goals")
    .select("id,name,target_amount,target_date,status")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("target_date", { ascending: true, nullsFirst: false })
    .limit(20);
  if (goalsError) throw new Error(`goals:${goalsError.message}`);

  const goals = ((goalsData as Record<string, unknown>[] | null) ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    target_amount: Number(row.target_amount) || 0,
    target_date: typeof row.target_date === "string" ? row.target_date : null,
  }));
  if (goals.length === 0) return null;

  const { data: contributions, error: contribError } = await sb.from("goal_contributions")
    .select("goal_id,amount")
    .eq("user_id", userId)
    .in("goal_id", goals.map((goal) => goal.id));
  if (contribError) throw new Error(`goal_contributions:${contribError.message}`);

  const totals = new Map<string, number>();
  for (const item of (contributions as Record<string, unknown>[] | null) ?? []) {
    const id = String(item.goal_id);
    totals.set(id, (totals.get(id) ?? 0) + Number(item.amount || 0));
  }
  return goals
    .map((row) => ({ row, current: totals.get(row.id) ?? 0 }))
    .filter((item) => item.current < item.row.target_amount)[0] ?? null;
}

export async function generateAdvisorReviews(
  sb: SupabaseClient,
  userId: string,
): Promise<{ weekly: number; monthly: number; skipped?: ReviewReadiness }> {
  const profile = await loadProfile(sb, userId);
  const ninetyDaysAgo = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
  const [{ count: txCount, error: countError }, { data: monthRows, error: monthError }] = await Promise.all([
    sb.from("transactions").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "confirmed").gte("occurred_at", ninetyDaysAgo),
    sb.from("transactions").select("occurred_at")
      .eq("user_id", userId).eq("status", "confirmed").gte("occurred_at", ninetyDaysAgo),
  ]);
  if (countError) throw new Error(`transactions_count:${countError.message}`);
  if (monthError) throw new Error(`transactions_months:${monthError.message}`);

  const monthsObserved = new Set(((monthRows as Array<{ occurred_at: string }> | null) ?? [])
    .map((row) => String(row.occurred_at).slice(0, 7))).size;
  const readiness = evaluateReadiness(Number(txCount ?? 0), monthsObserved);
  if (!readiness.eligible) return { weekly: 0, monthly: 0, skipped: readiness };

  const weeklyWindow = reviewWindow("weekly");
  const monthlyWindow = reviewWindow("monthly");
  const earliest = [weeklyWindow.previousStart, monthlyWindow.previousStart].sort()[0];
  const latest = [weeklyWindow.end, monthlyWindow.end].sort().at(-1)!;

  const [{ data: txData, error: txError }, { data: categoryData, error: categoryError }, selectedGoal] = await Promise.all([
    // Paginado: a Data API corta em 1.000 linhas e a revisão perdia período.
    fetchAllPages<any>((a, b) => sb.from("transactions")
      .select("id,amount,type,occurred_at,description,friendly_description,category_id,movement_kind,transfer_group_id,settles_card_id,split_transaction_role")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .gte("occurred_at", earliest)
      .lte("occurred_at", latest)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b), { source: "transactions" }).then((data) => ({ data, error: null })),
    sb.from("categories").select("id,name").or(`user_id.eq.${userId},user_id.is.null`),
    loadSelectedGoal(sb, userId),
  ]);
  if (txError) throw new Error(`transactions:${txError.message}`);
  if (categoryError) throw new Error(`categories:${categoryError.message}`);

  const categoryNames = new Map<string, string>();
  for (const row of (categoryData as Array<{ id: string; name: string }> | null) ?? []) {
    categoryNames.set(String(row.id), String(row.name));
  }
  const transactions = (txData as TxRow[] | null) ?? [];
  const weeklyFacts = computeFacts("weekly", weeklyWindow, transactions, categoryNames);
  const monthlyFacts = computeFacts("monthly", monthlyWindow, transactions, categoryNames);
  const reviews = [
    buildReview(weeklyFacts, selectedGoal, Number(profile.net_worth ?? 0)),
    buildReview(monthlyFacts, selectedGoal, Number(profile.net_worth ?? 0)),
  ];

  const counts = { weekly: 0, monthly: 0 };
  for (const review of reviews) {
    const { data: existingReview, error: existingError } = await sb.from("advisor_reviews")
      .select("actions,status")
      .eq("user_id", userId)
      .eq("period_kind", review.period_kind)
      .eq("period_start", review.period_start)
      .maybeSingle();
    if (existingError) throw new Error(`advisor_existing:${existingError.message}`);

    const existingActions = Array.isArray((existingReview as Record<string, unknown> | null)?.actions)
      ? (existingReview as { actions: AdvisorAction[] }).actions
      : [];
    const previousStatus = new Map(existingActions.map((action) => [action.key, action.status]));
    const mergedActions = review.actions.map((action) => ({
      ...action,
      status: previousStatus.get(action.key) ?? action.status,
    }));

    const { error } = await sb.from("advisor_reviews").upsert({
      user_id: userId,
      period_kind: review.period_kind,
      period_start: review.period_start,
      period_end: review.period_end,
      summary: review.summary,
      actions: mergedActions,
      status: mergedActions.length > 0 && mergedActions.every((action) => ["done", "dismissed"].includes(action.status))
        ? "completed"
        : "active",
      formula_version: review.formula_version,
      last_generated_at: new Date().toISOString(),
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,period_kind,period_start" });
    if (error) throw new Error(`advisor_upsert:${error.message}`);

    counts[review.period_kind]++;
    await sb.from("pending_proactive_suggestions").upsert({
      user_id: userId,
      kind: `advisor_review_${review.period_kind}`,
      severity: "info",
      title: review.period_kind === "weekly" ? "Sua revisão semanal está pronta" : "Seu fechamento mensal está pronto",
      body: review.summary.explanation,
      action: { route: `/app/assessor/acompanhamento?period=${review.period_kind}` },
      evidence: {
        period_start: review.period_start,
        period_end: review.period_end,
        formula_version: review.formula_version,
      },
      channel_ready: "both",
      dedup_key: `advisor_review:${review.period_kind}:${review.period_start}`,
      // Mesmo assunto do relatório inteligente do período (comms_contract.v2).
      logical_dedup_key: periodReviewKey(review.period_kind, userId, review.period_start),

      expires_at: new Date(Date.now() + 14 * DAY).toISOString(),
      status: "pending",
    }, { onConflict: "user_id,dedup_key", ignoreDuplicates: true });

    await remember(sb, {
      user_id: userId,
      kind: "advisor_review",
      key: `${review.period_kind}:${review.period_start}`,
      value: {
        summary: review.summary,
        actions: mergedActions.map((action) => ({ key: action.key, title: action.title, status: action.status })),
        period_end: review.period_end,
      },
      confidence: 1,
      source: "inferred",
      visibility: "internal",
      expires_at: new Date(Date.now() + 180 * DAY).toISOString(),
    });
  }

  return counts;
}
