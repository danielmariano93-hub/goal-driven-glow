// Runtime das metas hierárquicas (`spending_goals.v1`): carrega o livro
// canônico uma vez e entrega, para App, Nino e comunicação ativa, a MESMA
// leitura de cada meta (categoria + submetas + Outros) e a análise do
// histórico que sustenta as sugestões.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../derived/pagedSelect.ts";
import { buildGoalHistory, type GoalHistory } from "../finance-core/goalHistory.ts";
import type { TransactionRow } from "../finance-core/facts.ts";
import { buildMerchantResolver, type MerchantAliasRow, type MerchantResolver } from "../finance-core/merchant.ts";
import { evaluateCategoryGoal, type CategorySpendingGoalRow } from "../finance-core/metrics.ts";
import {
  analyzeSpendingHistory,
  buildSpendingLedger,
  evaluateGoalBreakdown,
  type GoalBreakdown,
  type MerchantTargetRow,
  type SpendingEntry,
  type SpendingHistoryAdvice,
} from "../finance-core/spendingGoals.ts";

const TX_COLUMNS = [
  "id", "account_id", "category_id", "type", "status", "amount", "occurred_at",
  "description", "merchant_name", "friendly_description", "transfer_group_id", "payment_method",
  "credit_card_id", "settles_card_id", "movement_kind", "posted_at", "competence_date",
  "refund_of_transaction_id", "origin", "purchase_date", "behavioral_day", "behavior_date_source",
  "behavior_date_confidence", "installments_total", "created_at",
].join(",");

export type SpendingGoalContext = {
  as_of: string;
  rows: TransactionRow[];
  entries: SpendingEntry[];
  resolver: MerchantResolver;
  categories: Array<{ id: string; name: string }>;
  goals: CategorySpendingGoalRow[];
  targets: MerchantTargetRow[];
};

export type GoalReading = {
  goal_id: string;
  category_id: string;
  category_name: string;
  period: { start: string; end: string };
  period_type: string;
  status: string;
  limit: number;
  baseline: number | null;
  actual: number;
  remaining: number;
  projected: number;
  projected_overage: number;
  current_overage: number;
  daily_allowance: number;
  supports_daily_budget: boolean;
  savings_goal_id: string | null;
  breakdown: GoalBreakdown;
};

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function loadSpendingGoalContext(
  sb: any,
  userId: string,
  asOf: string,
  opts: { monthsBack?: number } = {},
): Promise<SpendingGoalContext> {
  const monthsBack = opts.monthsBack ?? 13;
  const from = (() => {
    const d = new Date(`${asOf.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - monthsBack);
    return d.toISOString().slice(0, 10);
  })();
  const [rows, catsRes, aliasRes, goalsRes, targetsRes] = await Promise.all([
    fetchAllPages<any>((a, b) =>
      sb.from("transactions").select(TX_COLUMNS)
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .gte("occurred_at", shiftDays(from, -60))
        .lte("occurred_at", shiftDays(asOf, 45))
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true })
        .range(a, b),
    { source: "spending_goals" }),
    sb.from("categories").select("id,name,type").or(`user_id.eq.${userId},user_id.is.null`).is("archived_at", null),
    sb.from("merchant_aliases").select("alias_key,friendly_name,hits").eq("user_id", userId),
    sb.from("category_spending_goals").select("*").eq("user_id", userId).in("status", ["active", "paused"]),
    sb.from("spending_goal_merchant_targets").select("*").eq("user_id", userId).neq("status", "cancelled"),
  ]);
  for (const [name, res] of [["categories", catsRes], ["goals", goalsRes], ["targets", targetsRes]] as const) {
    if ((res as any).error) throw new Error(`spending_goals_${name}:${(res as any).error.message}`);
  }
  const aliases: MerchantAliasRow[] = (((aliasRes as any).data ?? []) as any[]).map((a) => ({
    alias_normalized: a.alias_key,
    canonical_name: a.friendly_name,
    confidence: Math.min(1, 0.5 + Number(a.hits ?? 1) / 20),
  }));
  const resolver = buildMerchantResolver(aliases);
  const typed = rows.map((row) => ({ ...row, amount: Number(row.amount ?? 0) })) as TransactionRow[];
  return {
    as_of: asOf,
    rows: typed,
    entries: buildSpendingLedger(typed as never, resolver),
    resolver,
    categories: (((catsRes as any).data ?? []) as any[])
      .filter((c) => String(c.type ?? "expense") === "expense")
      .map((c) => ({ id: String(c.id), name: String(c.name) })),
    goals: (((goalsRes as any).data ?? []) as any[]).map((g) => ({
      ...g,
      computed_limit: Number(g.computed_limit ?? 0),
      baseline_value: g.baseline_value == null ? null : Number(g.baseline_value),
      reduction_pct: g.reduction_pct == null ? null : Number(g.reduction_pct),
      fixed_limit: g.fixed_limit == null ? null : Number(g.fixed_limit),
    })) as CategorySpendingGoalRow[],
    targets: (((targetsRes as any).data ?? []) as any[]).map((t) => ({
      ...t,
      merchant_keys: Array.isArray(t.merchant_keys) ? t.merchant_keys.map(String) : [],
      limit_amount: t.limit_amount == null ? null : Number(t.limit_amount),
      reduction_pct: t.reduction_pct == null ? null : Number(t.reduction_pct),
      baseline_amount: t.baseline_amount == null ? null : Number(t.baseline_amount),
      computed_limit: t.computed_limit == null ? null : Number(t.computed_limit),
    })) as MerchantTargetRow[],
  };
}

/** Leitura de cada meta ativa: a mesma avaliação do teto + o detalhamento. */
export function readGoals(ctx: SpendingGoalContext): GoalReading[] {
  const today = new Date(`${ctx.as_of}T12:00:00Z`);
  const names = new Map(ctx.categories.map((c) => [c.id, c.name]));
  return ctx.goals.map((goal) => {
    const name = names.get(goal.category_id) ?? "Categoria";
    const ev = evaluateCategoryGoal(goal, ctx.rows, today, name);
    const breakdown = evaluateGoalBreakdown({
      goal: { id: goal.id, category_id: goal.category_id, limit: ev.targetAmount },
      period: ev.period,
      today: ctx.as_of,
      targets: ctx.targets.filter((t) => t.goal_id === goal.id),
      entries: ctx.entries,
    });
    return {
      goal_id: goal.id,
      category_id: goal.category_id,
      category_name: name,
      period: ev.period,
      period_type: ev.periodType,
      status: ev.status,
      limit: ev.targetAmount,
      baseline: goal.baseline_value ?? null,
      actual: ev.actualSpend,
      remaining: ev.remainingAmount,
      projected: ev.projectedFinalSpend,
      projected_overage: ev.projectedOverage,
      current_overage: ev.currentOverage,
      daily_allowance: ev.dailyAllowance,
      supports_daily_budget: ev.supportsDailyBudget,
      savings_goal_id: (goal as any).savings_goal_id ?? null,
      breakdown,
    };
  });
}

/** Histórico das metas como série por categoria (placar, KPIs e highlights). */
export function goalHistoryOf(ctx: SpendingGoalContext, readings: GoalReading[] = readGoals(ctx)): GoalHistory {
  return buildGoalHistory({
    today: ctx.as_of,
    goals: ctx.goals.map((g) => ({
      id: g.id,
      category_id: g.category_id,
      computed_limit: Number(g.computed_limit || 0),
      baseline_value: g.baseline_value ?? null,
      start_date: g.start_date,
      end_date: g.end_date ?? null,
      period_type: g.period_type ?? null,
      recurrence_end_date: g.recurrence_end_date ?? null,
      status: g.status,
      created_at: (g as unknown as { created_at?: string }).created_at ?? null,
    })),
    entries: ctx.entries,
    categories: ctx.categories,
    current: Object.fromEntries(readings.map((r) => [r.goal_id, { projected: r.projected, status: r.status }])),
  });
}

export function adviseGoals(ctx: SpendingGoalContext, opts: { onlyCategoryIds?: string[] } = {}): SpendingHistoryAdvice {
  return analyzeSpendingHistory({
    entries: ctx.entries,
    categories: ctx.categories,
    today: ctx.as_of,
    activeGoals: ctx.goals.filter((g) => g.status === "active").map((g) => ({ id: g.id, category_id: g.category_id })),
    onlyCategoryIds: opts.onlyCategoryIds,
  });
}

/** Estabelecimentos da categoria nos últimos 12 meses (para escolher a submeta). */
export function merchantOptions(ctx: SpendingGoalContext, categoryId: string) {
  const since = (() => {
    const d = new Date(`${ctx.as_of.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 12);
    return d.toISOString().slice(0, 7);
  })();
  // Referência recente: os 6 meses fechados (a mesma base do Nino).
  const recentFrom = (() => {
    const d = new Date(`${ctx.as_of.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 6);
    return d.toISOString().slice(0, 7);
  })();
  const current = ctx.as_of.slice(0, 7);
  const map = new Map<string, { key: string; label: string; total: number; recent: number; months: Set<string>; last: string }>();
  for (const e of ctx.entries) {
    if (e.category_id !== categoryId || e.month < since || e.merchant_key.startsWith("raw:sem_descricao")) continue;
    const row = map.get(e.merchant_key) ?? { key: e.merchant_key, label: e.merchant_label, total: 0, recent: 0, months: new Set(), last: e.date };
    row.total += e.amount;
    if (e.month >= recentFrom && e.month < current) row.recent += e.amount;
    if (e.amount > 0) row.months.add(e.month);
    if (e.date > row.last) row.last = e.date;
    map.set(e.merchant_key, row);
  }
  return [...map.values()]
    .filter((row) => row.total > 0)
    .map((row) => ({
      key: row.key,
      label: row.label,
      monthly_average: Math.round((Math.max(0, row.recent) / 6) * 100) / 100,
      total_12m: Math.round(row.total * 100) / 100,
      months_present: row.months.size,
      last_date: row.last,
    }))
    .sort((a, b) => b.total_12m - a.total_12m)
    .slice(0, 40);
}

const brlNote = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));

/**
 * Depois de um gasto: em qual submeta e meta ele entrou e como ficou o ritmo.
 * Só consulta o livro quando a categoria tem meta ativa.
 */
export async function expenseGoalNote(
  sb: any,
  userId: string,
  asOf: string,
  tx: { id?: unknown; category_id?: unknown; type?: unknown },
): Promise<string | null> {
  const categoryId = typeof tx.category_id === "string" ? tx.category_id : null;
  const txId = typeof tx.id === "string" ? tx.id : null;
  if (!categoryId || !txId || String(tx.type ?? "expense") !== "expense") return null;
  const { data: goal } = await sb.from("category_spending_goals")
    .select("id").eq("user_id", userId).eq("category_id", categoryId).eq("status", "active").limit(1).maybeSingle();
  if (!goal) return null;
  const ctx = await loadSpendingGoalContext(sb, userId, asOf, { monthsBack: 7 });
  const reading = readGoals(ctx).find((r) => r.category_id === categoryId && r.status !== "paused" && r.status !== "cancelled");
  if (!reading) return null;
  const entry = ctx.entries.find((e) => e.id === txId);
  if (!entry || entry.date < reading.period.start || entry.date > reading.period.end) return null;
  const target = reading.breakdown.targets.find((t) => t.merchant_keys.includes(entry.merchant_key));
  const pct = reading.limit > 0 ? Math.round((reading.actual / reading.limit) * 100) : 0;
  const parts: string[] = [];
  if (target) {
    parts.push(target.limit == null
      ? `Entrou na submeta de ${target.label} (${brlNote(target.actual)} no período) e na meta de ${reading.category_name} (${brlNote(reading.actual)} de ${brlNote(reading.limit)}, ${pct}%).`
      : `Entrou na submeta de ${target.label} (${brlNote(target.actual)} de ${brlNote(target.limit)}) e na meta de ${reading.category_name} (${brlNote(reading.actual)} de ${brlNote(reading.limit)}, ${pct}%).`);
    if (target.status === "zero_violated") parts.push(`A submeta de ${target.label} é zero: se for assinatura, vale cancelar.`);
  } else {
    parts.push(`Entrou na meta de ${reading.category_name}: ${brlNote(reading.actual)} de ${brlNote(reading.limit)} (${pct}%).`);
  }
  if (reading.current_overage > 0) parts.push(`O limite já passou em ${brlNote(reading.current_overage)}.`);
  else if (reading.projected_overage > 0) parts.push(`No ritmo atual, a categoria fecha em ${brlNote(reading.projected)}, acima do limite.`);
  return parts.join(" ");
}
