// Agent tools — server-side implementations. Each `execute` receives its
// user_id from the caller context (never from the model). All ownership
// checks happen inside the SQL RPCs or explicit WHERE user_id filters.
//
// The set below is used both by the LLM path (as JSON-schema tools) and
// as first-class helpers from the deterministic fallback.

// deno-lint-ignore-file no-explicit-any
// Local alias to avoid resolving the Deno remote URL from tsgo/vitest.
type SupabaseClient = any;
import { behavioralMetricAmount, isRealMonthlyMovement, type TransactionRow } from "../engine/facts.ts";
import { computeAgentSnapshot } from "../engine/metrics.ts";
import { cycleFor } from "../finance-core/cardExposure.ts";
import { executeWeekdayPattern } from "../intelligence/weekdayTool.ts";
import { computeBehavioralSignals } from "../insights/facts.ts";
import { resolveEntity, type Candidate } from "./resolvers.ts";
import { resolveOccurredAt, todaySaoPaulo } from "./parser.ts";
import { buildReceipt } from "./core/ReceiptBuilder.ts";
import { confirmationExecutor } from "./core/PendingConfirmations.ts";
import { resolveBehavioralDate } from "../analytics/behavioralDate.ts";
import { makeProvenance } from "../analytics/provenance.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const AGENT_QUERY_PAGE_SIZE = 1_000;
const AGENT_QUERY_MAX_ROWS = 100_000;

type TransactionQueryOptions = {
  select: string;
  from?: string;
  to?: string;
  toExclusive?: string;
  status?: string;
  paymentMethod?: "account" | "credit_card";
};

export type ToolContext = {
  sb: SupabaseClient;
  user_id: string;
  conversation_id: string;
  /** Raw user text of the current turn. Used server-side to derive
   *  occurred_at from pt-BR relative anchors (hoje/ontem/anteontem)
   *  regardless of any date the model may have hallucinated. */
  user_text?: string;
};

export type ToolResult =
  | { ok: true; result: any }
  | { ok: false; error: string; details?: unknown; result?: any; violations?: unknown };

/**
 * Supabase projects commonly cap REST results at 1,000 rows. Financial tools
 * must never turn that truncation into a confident answer, so every analytical
 * transaction read goes through this bounded, deterministic paginator.
 */
async function fetchTransactions(
  ctx: ToolContext,
  options: TransactionQueryOptions,
): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < AGENT_QUERY_MAX_ROWS; offset += AGENT_QUERY_PAGE_SIZE) {
    let query = ctx.sb.from("transactions")
      .select(options.select)
      .eq("user_id", ctx.user_id)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + AGENT_QUERY_PAGE_SIZE - 1);
    if (options.from) query = query.gte("occurred_at", options.from);
    if (options.to) query = query.lte("occurred_at", options.to);
    if (options.toExclusive) query = query.lt("occurred_at", options.toExclusive);
    if (options.status) query = query.eq("status", options.status);
    if (options.paymentMethod) query = query.eq("payment_method", options.paymentMethod);
    const { data, error } = await query;
    if (error) throw new Error(`transactions_query_failed:${error.message}`);
    const page = (data ?? []) as any[];
    rows.push(...page);
    if (page.length < AGENT_QUERY_PAGE_SIZE) return rows;
  }
  throw new Error(`transactions_query_exceeded_${AGENT_QUERY_MAX_ROWS}_rows`);
}

// ---------- Executors ----------

export async function list_accounts(ctx: ToolContext): Promise<ToolResult> {
  const { data, error } = await ctx.sb.from("accounts")
    .select("id,name,type,active,opening_balance")
    .eq("user_id", ctx.user_id).eq("active", true).order("name");
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data ?? [] };
}

export async function list_categories(ctx: ToolContext, args: { type?: "income"|"expense" }): Promise<ToolResult> {
  const type = args?.type;
  const q = ctx.sb.from("categories").select("id,name,type,user_id").is("archived_at", null);
  const { data: personal, error: personalError } = type
    ? await q.eq("user_id", ctx.user_id).eq("type", type)
    : await q.eq("user_id", ctx.user_id);
  const gq = ctx.sb.from("categories").select("id,name,type,user_id").is("archived_at", null).is("user_id", null);
  const { data: global, error: globalError } = type
    ? await gq.eq("type", type)
    : await gq;
  if (personalError || globalError) return { ok: false, error: personalError?.message ?? globalError?.message ?? "categories_query_failed" };
  return { ok: true, result: [...(personal ?? []), ...(global ?? [])] };
}

export async function get_financial_summary(ctx: ToolContext): Promise<ToolResult> {
  try {
    const snap = await computeAgentSnapshot(ctx.sb, ctx.user_id);
    return { ok: true, result: {
      month: snap.month_start.slice(0, 7),
      income: snap.current_month_income,
      expense: snap.current_month_expense,
      net: snap.period_performance?.operational_result
        ?? snap.current_month_income - snap.current_month_expense,
      available_today: snap.available_today,
      projected_month_end_available: snap.projected_month_end_available,
      formula_version: snap.formula_version,
    } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function list_recent_transactions(ctx: ToolContext, args: { limit?: number }): Promise<ToolResult> {
  const limit = Math.min(20, Math.max(1, args?.limit ?? 5));
  const { data, error } = await ctx.sb.from("transactions")
    .select("id,type,amount,occurred_at,description,account_id,category_id")
    .eq("user_id", ctx.user_id).order("occurred_at", { ascending: false }).limit(limit);
  if (error) return { ok: false, error: `transactions_query_failed:${error.message}` };
  return { ok: true, result: data ?? [] };
}

export async function analyze_spending(ctx: ToolContext, args: {
  days?: number; from?: string; to?: string; payment_method?: "account" | "credit_card";
}): Promise<ToolResult> {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = iso.test(args?.to ?? "") ? args.to! : todaySaoPaulo();
  const days = Math.max(1, Math.min(366, Number(args?.days ?? 30)));
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const from = iso.test(args?.from ?? "") ? args.from! : start.toISOString().slice(0, 10);

  const [data, categoriesResult] = await Promise.all([
    fetchTransactions(ctx, {
      select: "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind",
      from,
      to,
      paymentMethod: args?.payment_method,
    }),
    ctx.sb.from("categories").select("id,name").or(`user_id.eq.${ctx.user_id},user_id.is.null`).is("archived_at", null),
  ]);
  if (categoriesResult.error) return { ok: false, error: `categories_query_failed:${categoriesResult.error.message}` };
  const categories = categoriesResult.data;

  const names = new Map((categories ?? []).map((c: any) => [c.id, c.name]));
  const rows = (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }));
  // Aplica a MESMA definição de consumo real da Home: exclui aplicações,
  // aportes, transferências, pagamento de fatura, cancelados. Corrige o bug em
  // que "Aplicações R$ 5.000" aparecia como maior gasto do mês.
  const byCategory = new Map<string, number>();
  const byDay = new Map<string, number>();
  let totalExpense = 0;
  let totalIncome = 0;
  let expenseRows = 0;
  for (const row of rows) {
    const expenseAmount = behavioralMetricAmount(row as any, "expense");
    const incomeAmount = behavioralMetricAmount(row as any, "income");
    totalIncome += incomeAmount;
    if (expenseAmount === 0) continue;
    const category = String(row.category_id ? (names.get(row.category_id) ?? "Sem categoria") : "Sem categoria");
    byCategory.set(category, (byCategory.get(category) ?? 0) + expenseAmount);
    byDay.set(row.occurred_at, (byDay.get(row.occurred_at) ?? 0) + expenseAmount);
    totalExpense += expenseAmount;
    expenseRows += 1;
  }
  const categoriesRank = [...byCategory.entries()]
    .map(([name, value]) => ({ name, value: Math.round(Math.max(0, value) * 100) / 100 }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const daily = [...byDay.entries()].map(([date, value]) => ({
    date,
    value: Math.round(Math.max(0, value) * 100) / 100,
  }));
  totalExpense = Math.max(0, totalExpense);
  const uncategorized = categoriesRank.find((c) => c.name === "Sem categoria")?.value ?? 0;
  return {
    ok: true,
    result: {
      kind: "spending_report", period: { from, to, days },
      totals: { expense: Math.round(totalExpense * 100) / 100, income: Math.round(totalIncome * 100) / 100, net: Math.round((totalIncome - totalExpense) * 100) / 100 },
      transactions_count: expenseRows, categories: categoriesRank, daily,
      top_category: categoriesRank[0] ?? null, uncategorized,
      data_limit: expenseRows === 0 ? "no_data" : expenseRows < 3 ? "small_sample" : null,
      formula_version: "analyze_spending.consumption.v3",
    },
  };
}

/** Literal spend lookup for one behavioral date. Unlike analyze_spending,
 * this includes transactions posted in the following business days and then
 * resolves them back to the purchase/automation date when confidence permits. */
export async function get_spending_for_date(ctx: ToolContext, args: { date: string }): Promise<ToolResult> {
  const date = String(args?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "invalid_date" };
  const postedThrough = new Date(`${date}T12:00:00Z`);
  postedThrough.setUTCDate(postedThrough.getUTCDate() + 3);
  const to = postedThrough.toISOString().slice(0, 10);
  const [data, categoriesResult] = await Promise.all([
    fetchTransactions(ctx, {
      select: "id,account_id,category_id,type,status,amount,occurred_at,behavioral_day,behavior_date_source,behavior_date_confidence,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind",
      from: date,
      to,
    }),
    ctx.sb.from("categories").select("id,name").or(`user_id.eq.${ctx.user_id},user_id.is.null`).is("archived_at", null),
  ]);
  if (categoriesResult.error) return { ok: false, error: `categories_query_failed:${categoriesResult.error.message}` };
  const categories = categoriesResult.data;
  const names = new Map((categories ?? []).map((c: any) => [c.id, c.name]));
  let total = 0;
  let transactions = 0;
  let excludedLowConfidence = 0;
  const byCategory = new Map<string, number>();
  for (const raw of (data ?? []) as any[]) {
    const resolved = resolveBehavioralDate(raw);
    if (resolved.day !== date) continue;
    if (!resolved.eligibleForBehavior) {
      excludedLowConfidence++;
      continue;
    }
    const amount = behavioralMetricAmount({ ...raw, amount: Number(raw.amount) } as any, "expense");
    if (amount <= 0) continue;
    const category = String(raw.category_id ? (names.get(raw.category_id) ?? "Sem categoria") : "Sem categoria");
    total += amount;
    transactions++;
    byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
  }
  return { ok: true, result: {
    date,
    total: Math.round(total * 100) / 100,
    transactions_count: transactions,
    categories: [...byCategory.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value),
    excluded_low_confidence: excludedLowConfidence,
    formula_version: "spending.behavioral-date.literal.v1",
  } };
}

export async function run_before_spending(ctx: ToolContext, args: {
  amount: number;
  account_hint?: string;
  category?: string;
  planned_date?: string;
  method?: "cash" | "card";
  card?: string;
  installments?: number;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const plannedDateInput = String(args?.planned_date ?? "");
  const plannedDateValue = new Date(`${plannedDateInput}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDateInput)
    || Number.isNaN(plannedDateValue.getTime())
    || plannedDateValue.toISOString().slice(0, 10) !== plannedDateInput) {
    return { ok: false, error: "missing_planned_date" };
  }
  const snapshotResult = await computeAgentSnapshot(ctx.sb, ctx.user_id);
  if (plannedDateInput < snapshotResult.today) return { ok: false, error: "planned_date_in_past" };
  let account: { id: string; name: string } | null = null;
  if (args?.account_hint) {
    account = await resolveAccountId(ctx, args.account_hint);
    if (!account) return { ok: false, error: "account_not_found" };
  }
  const installments = Math.max(1, Math.min(48, Math.floor(Number(args?.installments ?? 1))));
  const installmentAmount = Math.round(amount / installments * 100) / 100;
  const plannedDate = plannedDateInput;
  const categoryId = await resolveCategoryId(ctx, args?.category, "expense");
  if (args?.category && !categoryId) return { ok: false, error: "category_not_found" };
  const categoryGoals = categoryId
    ? snapshotResult.active_category_goals.filter((goal) => goal.category_id === categoryId)
    : [];
  const exactCategoryGoal = categoryGoals.find((goal) =>
    plannedDate >= goal.period_start && plannedDate <= goal.period_end
  ) ?? null;
  const recurringCategoryGoal = categoryGoals.find((goal) => goal.period_type === "monthly_recurring") ?? null;
  const categoryGoal = exactCategoryGoal ?? recurringCategoryGoal;
  const sameGoalPeriod = Boolean(categoryGoal
    && plannedDate >= categoryGoal.period_start && plannedDate <= categoryGoal.period_end);
  const spentBefore = sameGoalPeriod ? Number(categoryGoal?.actual_spend ?? 0) : 0;
  const plannedMonthStart = `${plannedDate.slice(0, 7)}-01`;
  const [plannedYear, plannedMonth] = plannedDate.split("-").map(Number);
  const plannedMonthEnd = `${plannedDate.slice(0, 7)}-${String(new Date(Date.UTC(plannedYear, plannedMonth, 0)).getUTCDate()).padStart(2, "0")}`;
  const categoryGoalImpact = categoryGoal ? {
    category_id: categoryGoal.category_id,
    category_name: categoryGoal.category_name ?? "Categoria",
    limit: categoryGoal.target_amount,
    period_start: sameGoalPeriod ? categoryGoal.period_start : plannedMonthStart,
    period_end: sameGoalPeriod ? categoryGoal.period_end : plannedMonthEnd,
    spent_before: spentBefore,
    spent_after: Math.round((spentBefore + amount) * 100) / 100,
    remaining_before: Math.round((categoryGoal.target_amount - spentBefore) * 100) / 100,
    remaining_after: Math.round((categoryGoal.target_amount - spentBefore - amount) * 100) / 100,
    exceeds: spentBefore + amount > categoryGoal.target_amount,
  } : null;

  const cardResolution = (args?.method === "card" || !args?.method)
    ? await resolveCreditCardFull(ctx, args?.card)
    : null;
  if (args?.method === "card" && cardResolution?.kind !== "single") {
    return {
      ok: false,
      error: cardResolution?.kind === "multiple" ? "card_ambiguous" : "card_not_found",
      result: cardResolution,
    };
  }
  const cardConfigRes = cardResolution?.kind === "single"
    ? await ctx.sb.from("credit_cards").select("id,name,closing_day,due_day").eq("id", cardResolution.id).eq("user_id", ctx.user_id).maybeSingle()
    : { data: null, error: null };
  if (cardConfigRes.error) throw new Error(`card_config_query_failed:${cardConfigRes.error.message}`);
  if (cardResolution?.kind === "single" && !cardConfigRes.data) return { ok: false, error: "card_not_found" };
  const cardConfig = cardConfigRes.data;

  const scenario = (method: "cash" | "card") => {
    const cycle = method === "card" && cardConfig ? cycleFor(cardConfig as any, plannedDate) : null;
    const cashImpactDate = method === "card" ? cycle?.due_date ?? null : plannedDate;
    const immediateImpact = method === "cash" && plannedDate <= snapshotResult.today ? amount : 0;
    const monthImpact = cashImpactDate && cashImpactDate <= snapshotResult.month_end
      ? (method === "card" ? installmentAmount : amount)
      : 0;
    return {
      method,
      available_today: snapshotResult.available_today,
      available_after_now: Math.round((snapshotResult.available_today - immediateImpact) * 100) / 100,
      projected_month_end_before: snapshotResult.projected_month_end_available,
      projected_month_end_after: Math.round((snapshotResult.projected_month_end_available - monthImpact) * 100) / 100,
      cash_impact_date: cashImpactDate,
      card_competence: cycle?.competence ?? null,
      card: method === "card" && cardResolution?.kind === "single"
        ? { id: cardResolution.id, name: cardResolution.name }
        : null,
      complete: method === "cash" || cardResolution?.kind === "single",
    };
  };
  const scenarios = args?.method
    ? [scenario(args.method)]
    : [scenario("cash"), ...(cardResolution?.kind === "single" ? [scenario("card")] : [])];
  const primary = scenarios[0];
  return {
    ok: true,
    result: {
      formula_version: "agent_spending_simulation.snapshot.v4",
      reconciliation_id: snapshotResult.reconciliation_id,
      amount, method: args?.method ?? null, installments, installment_amount: installmentAmount,
      planned_date: plannedDate,
      cash_impact_date: primary.cash_impact_date,
      card_competence: primary.card_competence,
      available_today: primary.available_today,
      available_after_now: primary.available_after_now,
      projected_month_end_before: primary.projected_month_end_before,
      projected_month_end_after: primary.projected_month_end_after,
      known_future_commitments: snapshotResult.known_future_commitments,
      scenarios,
      category_goal_impact: categoryGoalImpact,
      category_requested: Boolean(args?.category),
      category_resolved: categoryId ? { id: categoryId, name: categoryGoal?.category_name ?? args?.category ?? "Categoria" } : null,
      category_goal_found: Boolean(categoryGoalImpact),
      goals_at_risk: categoryGoalImpact?.exceeds ? [categoryGoalImpact] : [],
      account: account,
      card: primary.card,
      requires_card_selection: !args?.method && cardResolution?.kind === "multiple"
        ? cardResolution.choices
        : [],
      assumptions: [
        "A compra afeta a categoria integralmente na data planejada.",
        args?.method === "card" ? "No cartão, o caixa muda no vencimento da parcela." : args?.method === "cash" ? "À vista, o caixa muda na data planejada." : "Como o meio de pagamento não foi informado, o cálculo apresenta cenários sem escolher por você.",
      ],
      limitations: [
        ...(!args?.category ? ["Categoria não informada; nenhuma meta de categoria foi presumida."] : []),
        ...(!args?.method && cardResolution?.kind === "multiple" ? ["Há mais de um cartão ativo; informe o cartão para calcular o vencimento do cenário a crédito."] : []),
      ],
    },
  };
}

async function upsertDraft(ctx: ToolContext, kind: string, payload: any, summary: string): Promise<string | null> {
  const { data, error } = await ctx.sb.rpc("agent_upsert_draft", {
    p_user_id: ctx.user_id,
    p_conversation_id: ctx.conversation_id,
    p_kind: kind,
    p_payload: payload,
    p_summary: summary,
    p_ttl_minutes: 15,
  });
  if (error) throw new Error(`draft_persistence_failed:${error.message}`);
  return data as string;
}

async function resolveAccountId(ctx: ToolContext, hintOrId?: string): Promise<{ id: string; name: string } | null> {
  if (hintOrId === undefined || hintOrId === null) return null;
  const { data, error } = await ctx.sb.from("accounts").select("id,name,type")
    .eq("user_id", ctx.user_id).eq("active", true);
  if (error) throw new Error(`accounts_query_failed:${error.message}`);
  const list: Candidate[] = (data ?? []).map((a: any) => ({
    id: a.id, name: a.name, aliases: [a.type].filter(Boolean),
  }));
  const r = resolveEntity(hintOrId, list);
  if (r.kind === "single") return { id: r.match.id, name: r.match.name };
  return null;
}

async function resolveCategoryId(ctx: ToolContext, hintOrId: string | undefined, type: "income"|"expense"): Promise<string | null> {
  if (!hintOrId) return null;
  if (/^[0-9a-f-]{36}$/i.test(hintOrId)) {
    const { data, error } = await ctx.sb.from("categories").select("id,user_id,type")
      .eq("id", hintOrId).is("archived_at", null).maybeSingle();
    if (error) throw new Error(`categories_query_failed:${error.message}`);
    if (!data) return null;
    if (data.user_id && data.user_id !== ctx.user_id) return null;
    if (String((data as any).type) !== type) return null;
    return data.id as string;
  }
  const { data: personal, error: personalError } = await ctx.sb.from("categories").select("id,name,type")
    .eq("user_id", ctx.user_id).is("archived_at", null).eq("type", type);
  const { data: global, error: globalError } = await ctx.sb.from("categories").select("id,name,type")
    .is("user_id", null).is("archived_at", null).eq("type", type);
  if (personalError || globalError) throw new Error(`categories_query_failed:${personalError?.message ?? globalError?.message}`);
  const all = [...(personal ?? []), ...(global ?? [])];
  const list: Candidate[] = all.map((c: any) => ({ id: c.id, name: c.name }));
  const r = resolveEntity(hintOrId, list);
  if (r.kind === "single") return r.match.id;
  return null;
}

async function resolveCreditCardFull(ctx: ToolContext, hintOrId?: string): Promise<
  | { kind: "single"; id: string; name: string }
  | { kind: "multiple"; choices: Array<{ id: string; name: string }> }
  | { kind: "none"; available: Array<{ id: string; name: string }> }
> {
  const { data, error } = await ctx.sb.from("credit_cards").select("id,name,brand,last_four")
    .eq("user_id", ctx.user_id).eq("active", true);
  if (error) throw new Error(`cards_query_failed:${error.message}`);
  const list: Candidate[] = (data ?? []).map((c: any) => ({
    id: c.id, name: c.name,
    aliases: [c.brand, c.last_four ? String(c.last_four) : null].filter(Boolean) as string[],
  }));
  const r = resolveEntity(hintOrId ?? "", list);
  if (r.kind === "single") return { kind: "single", id: r.match.id, name: r.match.name };
  if (r.kind === "multiple") return { kind: "multiple", choices: r.matches.map(m => ({ id: m.id, name: m.name })) };
  return { kind: "none", available: list.map(c => ({ id: c.id, name: c.name })) };
}

async function resolveCreditCardId(ctx: ToolContext, hintOrId?: string): Promise<{ id: string; name: string } | null> {
  const r = await resolveCreditCardFull(ctx, hintOrId);
  return r.kind === "single" ? { id: r.id, name: r.name } : null;
}

export { resolveCreditCardFull };

export async function list_credit_cards(ctx: ToolContext): Promise<ToolResult> {
  const { data, error } = await ctx.sb.from("credit_cards")
    .select("id,name,brand,closing_day,due_day,total_limit")
    .eq("user_id", ctx.user_id).eq("active", true).order("name");
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data ?? [] };
}

const METHOD_ONLY_TERMS = new Set([
  "credito","crédito","debito","débito","pix","dinheiro","cartao","cartão",
  "boleto","transferencia","transferência","ted","doc","fatura","credit_card","account",
]);

function normalizeDesc(s?: string | null): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

function normalizeExplicitCategoryText(s?: string | null): string {
  return normalizeDesc(s).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isExplicitCategoryMention(userText?: string | null, category?: string | null): boolean {
  const text = normalizeExplicitCategoryText(userText);
  const cat = normalizeExplicitCategoryText(category);
  if (!text || !cat) return false;
  const cues = [
    `categoria ${cat}`, `categoria de ${cat}`, `categoriza em ${cat}`, `categorize em ${cat}`,
    `classifica como ${cat}`, `classifique como ${cat}`, `coloca em ${cat}`, `coloque em ${cat}`,
    `lanca em ${cat}`, `registre em ${cat}`, `registra em ${cat}`,
  ];
  return cues.some((cue) => text.includes(cue));
}

export async function create_transaction_draft(ctx: ToolContext, args: {
  type: "income"|"expense"; amount: number; account?: string;
  credit_card?: string; installments_total?: number;
  category?: string; occurred_at?: string; description?: string;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  if (args.type !== "income" && args.type !== "expense") return { ok: false, error: "invalid_type" };
  const rawDesc = (args.description ?? "").trim();
  const normDesc = normalizeDesc(rawDesc);
  if (rawDesc && METHOD_ONLY_TERMS.has(normDesc)) {
    return { ok: false, error: "needs_description", hint: "A descrição não pode ser apenas o meio de pagamento (crédito, débito, pix, cartão…). Pergunte ao usuário 'em quê foi essa compra?' antes de criar o rascunho." } as any;
  }
  const occurred_at = resolveOccurredAt({ text: ctx.user_text, modelValue: args.occurred_at ?? null }).iso;
  // Category Truth V2: only a category literally requested by the user may enter the draft as user truth.
  // Any model-inferred category stays null and is resolved by the central queue after confirmation.
  const explicitCategoryHint = isExplicitCategoryMention(ctx.user_text, args.category) ? args.category : undefined;
  const cat = await resolveCategoryId(ctx, explicitCategoryHint, args.type);

  if (args.credit_card && args.type === "expense") {
    const card = await resolveCreditCardId(ctx, args.credit_card);
    if (!card) return { ok: false, error: "card_not_found" };
    const n = Math.max(1, Math.min(48, Number(args.installments_total ?? 1) || 1));
    const payload = {
      type: args.type, amount, occurred_at,
      description: args.description ?? null,
      category_id: cat,
      category_explicit: Boolean(cat && explicitCategoryHint),
      payment_method: "credit_card",
      credit_card_id: card.id,
      installments_total: n,
    };
    const parcelStr = n > 1 ? ` em ${n}x` : "";
    const summary = `Despesa de ${BRL.format(amount)} no cartão ${card.name}${parcelStr}${args.description ? ` — ${args.description}` : ""} em ${occurred_at}.`;
    const id = await upsertDraft(ctx, "transaction", payload, summary);
    if (!id) return { ok: false, error: "draft_failed" };
    return { ok: true, result: { draft_id: id, summary, card: card.name, installments_total: n } };
  }

  const acc = await resolveAccountId(ctx, args.account);
  if (!acc) return { ok: false, error: "account_not_found" };
  const payload = { type: args.type, amount, account_id: acc.id, category_id: cat, category_explicit: Boolean(cat && explicitCategoryHint), occurred_at, description: args.description ?? null, payment_method: "account" };
  const summary = `${args.type === "income" ? "Receita" : "Despesa"} de ${BRL.format(amount)} em ${acc.name}${args.description ? ` — ${args.description}` : ""} em ${occurred_at}.`;
  const id = await upsertDraft(ctx, "transaction", payload, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function create_transfer_draft(ctx: ToolContext, args: {
  amount: number; from_account: string; to_account: string; occurred_at?: string; description?: string;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const from = await resolveAccountId(ctx, args.from_account);
  const to = await resolveAccountId(ctx, args.to_account);
  if (!from || !to) return { ok: false, error: "account_not_found" };
  if (from.id === to.id) return { ok: false, error: "same_account" };
  const occurred_at = resolveOccurredAt({ text: ctx.user_text, modelValue: args.occurred_at ?? null }).iso;
  const summary = `Transferência de ${BRL.format(amount)} de ${from.name} para ${to.name} em ${occurred_at}.`;
  const id = await upsertDraft(ctx, "transfer", { amount, from_account_id: from.id, to_account_id: to.id, occurred_at, description: args.description ?? null }, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function pay_credit_card_bill_draft(ctx: ToolContext, args: {
  amount: number;
  account: string;
  card: string;
  occurred_at?: string;
  description?: string;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const acc = await resolveAccountId(ctx, args.account);
  if (!acc) return { ok: false, error: "account_not_found" };
  const card = await resolveCreditCardId(ctx, args.card);
  if (!card) return { ok: false, error: "card_not_found" };
  const occurred_at = resolveOccurredAt({ text: ctx.user_text, modelValue: args.occurred_at ?? null }).iso;
  const summary = `Pagamento de fatura do cartão ${card.name} no valor de ${BRL.format(amount)} debitando ${acc.name} em ${occurred_at}.`;
  const id = await upsertDraft(ctx, "credit_card_bill_payment", {
    amount,
    account_id: acc.id,
    settles_card_id: card.id,
    occurred_at,
    description: args.description ?? null,
  }, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function create_goal_draft(ctx: ToolContext, args: {
  name: string; target_amount: number; target_date?: string; priority?: number;
}): Promise<ToolResult> {
  const name = String(args?.name ?? "").trim();
  const target = Number(args?.target_amount);
  if (!name) return { ok: false, error: "invalid_name" };
  if (!Number.isFinite(target) || target <= 0) return { ok: false, error: "invalid_amount" };
  const summary = `Meta “${name}” com alvo de ${BRL.format(target)}${args.target_date ? ` até ${args.target_date}` : ""}.`;
  const id = await upsertDraft(ctx, "goal", {
    name, target_amount: target,
    target_date: /^\d{4}-\d{2}-\d{2}$/.test(args.target_date ?? "") ? args.target_date : null,
    priority: Math.min(5, Math.max(1, Number(args.priority ?? 3))),
  }, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function add_goal_contribution_draft(ctx: ToolContext, args: {
  goal: string; amount: number; occurred_at?: string; account?: string;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const hint = String(args?.goal ?? "").trim();
  if (!hint) return { ok: false, error: "invalid_goal" };
  // Resolve goal
  let goalId: string | null = null; let goalName = "";
  if (/^[0-9a-f-]{36}$/i.test(hint)) {
    const { data, error } = await ctx.sb.from("goals").select("id,name").eq("id", hint).eq("user_id", ctx.user_id).maybeSingle();
    if (error) return { ok: false, error: `goals_query_failed:${error.message}` };
    if (data) { goalId = data.id as string; goalName = data.name as string; }
  } else {
    const { data, error } = await ctx.sb.from("goals").select("id,name").eq("user_id", ctx.user_id).eq("status", "active");
    if (error) return { ok: false, error: `goals_query_failed:${error.message}` };
    const h = hint.toLowerCase();
    const m = (data ?? []).find(g => (g.name as string).toLowerCase().includes(h));
    if (m) { goalId = m.id as string; goalName = m.name as string; }
  }
  if (!goalId) return { ok: false, error: "goal_not_found" };
  const acc = args.account ? await resolveAccountId(ctx, args.account) : null;
  const occurred_at = resolveOccurredAt({ text: ctx.user_text, modelValue: args.occurred_at ?? null }).iso;
  const summary = `Aporte de ${BRL.format(amount)} para “${goalName}”${acc ? ` de ${acc.name}` : ""} em ${occurred_at}.`;
  const id = await upsertDraft(ctx, "goal_contribution", { goal_id: goalId, amount, account_id: acc?.id ?? null, occurred_at }, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function create_debt_draft(ctx: ToolContext, args: {
  name: string; original_amount: number; outstanding_balance?: number;
  installment_amount?: number; due_day?: number; creditor?: string;
}): Promise<ToolResult> {
  const name = String(args?.name ?? "").trim();
  const original = Number(args?.original_amount);
  if (!name) return { ok: false, error: "invalid_name" };
  if (!Number.isFinite(original) || original <= 0) return { ok: false, error: "invalid_amount" };
  const outstanding = Number.isFinite(Number(args.outstanding_balance)) ? Number(args.outstanding_balance) : original;
  const payload = {
    name, creditor: args.creditor ?? null,
    original_amount: original,
    outstanding_balance: outstanding,
    installment_amount: Number.isFinite(Number(args.installment_amount)) ? Number(args.installment_amount) : null,
    due_day: args.due_day && args.due_day >= 1 && args.due_day <= 31 ? args.due_day : null,
  };
  const summary = `Dívida “${name}” — total ${BRL.format(original)}${payload.installment_amount ? `, parcela ${BRL.format(payload.installment_amount!)}` : ""}.`;
  const id = await upsertDraft(ctx, "debt", payload, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function cancel_pending_action(ctx: ToolContext): Promise<ToolResult> {
  const { data, error } = await ctx.sb.from("pending_confirmations")
    .select("id").eq("conversation_id", ctx.conversation_id).eq("status", "pending").maybeSingle();
  if (error) return { ok: false, error: `pending_confirmation_query_failed:${error.message}` };
  if (!data) return { ok: true, result: { cancelled: false, reason: "nothing_pending" } };
  const { error: cancelError } = await ctx.sb.from("pending_confirmations").update({ status: "cancelled" }).eq("id", data.id);
  if (cancelError) return { ok: false, error: `pending_confirmation_cancel_failed:${cancelError.message}` };
  return { ok: true, result: { cancelled: true } };
}

export async function confirm_pending_action(ctx: ToolContext, args: { id?: string }): Promise<ToolResult> {
  let q = ctx.sb.from("pending_confirmations")
    .select("id, kind, expires_at")
    .eq("conversation_id", ctx.conversation_id)
    .eq("user_id", ctx.user_id)
    .eq("status", "pending");
  if (args?.id) q = q.eq("id", args.id);
  const { data: pending, error: pendingError } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pendingError) return { ok: false, error: `pending_confirmation_query_failed:${pendingError.message}` };
  if (!pending) return { ok: false, error: "no_pending_confirmation" };
  if (new Date((pending as any).expires_at).getTime() <= Date.now()) {
    const { error: expireError } = await ctx.sb.from("pending_confirmations").update({ status: "expired" }).eq("id", (pending as any).id).eq("status", "pending");
    if (expireError) return { ok: false, error: `pending_confirmation_expire_failed:${expireError.message}` };
    return { ok: false, error: "expired" };
  }
  const executor = confirmationExecutor((pending as any).kind);
  const { data: exec, error: execError } = await ctx.sb.rpc(executor, {
    p_confirmation_id: (pending as any).id,
    p_source_message_id: null,
  });
  if (execError) return { ok: false, error: `confirmation_rpc_failed:${execError.message}` };
  const result = exec as { ok?: boolean; result?: any; error?: string; idempotent?: boolean } | null;
  if (!result?.ok) return { ok: false, error: result?.error ?? "confirmation_failed" };
  return {
    ok: true,
    result: {
      draft_id: (pending as any).id,
      kind: (pending as any).kind,
      idempotent: !!result.idempotent,
      receipt: result.idempotent
        ? "Essa operação já havia sido confirmada. Está tudo certo por aqui. ✅"
        : buildReceipt((pending as any).kind, result.result),
      result: result.result,
    },
  };
}

// ---------- Read/edit tools (novas) ----------

export async function search_transactions(ctx: ToolContext, args: {
  query?: string; days?: number; type?: "income" | "expense" | "transfer"; limit?: number;
}): Promise<ToolResult> {
  const days = Math.max(1, Math.min(180, Number(args?.days ?? 60)));
  const limit = Math.max(1, Math.min(20, Number(args?.limit ?? 10)));
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const term = (args?.query ?? "").trim();
  let q = ctx.sb.from("transactions")
    .select("id,type,amount,occurred_at,description,category_id,account_id,credit_card_id,payment_method,installment_number,installments_total,purchase_group_id,version")
    .eq("user_id", ctx.user_id).gte("occurred_at", since)
    .order("occurred_at", { ascending: false }).limit(limit);
  if (args?.type) q = q.eq("type", args.type);
  if (term) q = q.ilike("description", `%${term.replace(/[%_]/g, "\\$&")}%`);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data ?? [] };
}

export async function get_transaction(ctx: ToolContext, args: { transaction_id: string }): Promise<ToolResult> {
  if (!/^[0-9a-f-]{36}$/i.test(String(args?.transaction_id ?? ""))) return { ok: false, error: "invalid_id" };
  const { data, error } = await ctx.sb.from("transactions")
    .select("*").eq("id", args.transaction_id).eq("user_id", ctx.user_id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, result: data };
}

export async function draft_transaction_update(ctx: ToolContext, args: {
  transaction_id: string;
  patch: {
    description?: string | null; category?: string | null;
    amount?: number; occurred_at?: string; notes?: string | null;
    payment_method?: "account" | "credit_card";
    account?: string | null; credit_card?: string | null;
  };
  scope?: "one" | "future" | "all";
}): Promise<ToolResult> {
  const id = String(args?.transaction_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "invalid_id" };
  const { data: tx, error } = await ctx.sb.from("transactions")
    .select("id,user_id,version,type,amount,description,category_id,occurred_at,purchase_group_id,installment_number,payment_method,account_id,credit_card_id")
    .eq("id", id).eq("user_id", ctx.user_id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!tx) return { ok: false, error: "not_owned" };
  if ((tx as any).type === "transfer") return { ok: false, error: "transfer_not_editable" };

  const scope = args.scope && ["one","future","all"].includes(args.scope)
    ? (tx as any).purchase_group_id ? args.scope : "one"
    : "one";

  const patch: Record<string, unknown> = {};
  const p = args.patch ?? {};
  if (typeof p.description === "string" || p.description === null) {
    const desc = (p.description ?? "") as string;
    if (desc && METHOD_ONLY_TERMS.has(normalizeDesc(desc))) {
      return { ok: false, error: "needs_description" } as any;
    }
    patch.description = p.description ?? null;
  }
  if (typeof p.amount === "number" && p.amount > 0) patch.amount = p.amount;
  if (typeof p.occurred_at === "string" && p.occurred_at.trim()) {
    const r = resolveOccurredAt({ text: ctx.user_text, modelValue: p.occurred_at });
    patch.occurred_at = r.iso;
  }
  if (typeof p.notes === "string" || p.notes === null) patch.notes = p.notes ?? null;
  if (p.category !== undefined) {
    if (p.category === null || p.category === "") patch.category_id = null;
    else {
      const catId = await resolveCategoryId(ctx, String(p.category), (tx as any).type as "income" | "expense");
      if (!catId) return { ok: false, error: "category_not_found" };
      patch.category_id = catId;
    }
  }

  // Payment method / account / credit card handling
  const wantsPM = p.payment_method === "account" || p.payment_method === "credit_card";
  const wantsAccount = p.account !== undefined && p.account !== null && String(p.account).trim() !== "";
  const wantsCard = p.credit_card !== undefined && p.credit_card !== null && String(p.credit_card).trim() !== "";

  if (wantsPM || wantsAccount || wantsCard) {
    const targetMethod: "account" | "credit_card" =
      p.payment_method ?? (wantsCard ? "credit_card" : wantsAccount ? "account" : ((tx as any).payment_method ?? "account"));
    if (targetMethod === "credit_card") {
      const cardHint = wantsCard ? String(p.credit_card) : "";
      const resolved = cardHint ? await resolveCreditCardFull(ctx, cardHint) : null;
      if (resolved && resolved.kind === "multiple") {
        return { ok: false, error: "card_ambiguous", choices: resolved.choices } as any;
      }
      const cardId = resolved && resolved.kind === "single" ? resolved.id
        : ((tx as any).credit_card_id as string | null);
      if (!cardId) return { ok: false, error: "credit_card_required" };
      patch.payment_method = "credit_card";
      patch.credit_card_id = cardId;
      patch.account_id = null;
    } else {
      const accHint = wantsAccount ? String(p.account) : "";
      const acc = accHint ? await resolveAccountId(ctx, accHint) : null;
      const accId = acc ? acc.id : ((tx as any).account_id as string | null);
      if (!accId) return { ok: false, error: "account_required" };
      patch.payment_method = "account";
      patch.account_id = accId;
      patch.credit_card_id = null;
    }
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: "empty_patch" };

  const summary =
    `Editar lançamento (${scope === "one" ? "esta parcela" : scope === "future" ? "esta e futuras" : "todas as parcelas"}): ` +
    Object.entries(patch).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");

  const payload = {
    transaction_id: id,
    expected_version: (tx as any).version ?? 1,
    scope, patch,
    before: {
      description: (tx as any).description,
      category_id: (tx as any).category_id,
      amount: Number((tx as any).amount),
      occurred_at: (tx as any).occurred_at,
      payment_method: (tx as any).payment_method,
      account_id: (tx as any).account_id,
      credit_card_id: (tx as any).credit_card_id,
    },
  };
  const draftId = await upsertDraft(ctx, "transaction_update", payload, summary);
  if (!draftId) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: draftId, summary, transaction_id: id, scope, patch, before: (payload as any).before } };
}

export async function draft_transaction_delete(ctx: ToolContext, args: {
  transaction_id: string; scope?: "one" | "future" | "all";
}): Promise<ToolResult> {
  const id = String(args?.transaction_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "invalid_id" };
  const { data: tx, error } = await ctx.sb.from("transactions")
    .select("id,user_id,version,type,amount,description,occurred_at,purchase_group_id,installment_number,transfer_group_id")
    .eq("id", id).eq("user_id", ctx.user_id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!tx) return { ok: false, error: "not_owned" };
  const scope = args.scope && ["one","future","all"].includes(args.scope)
    ? (tx as any).purchase_group_id ? args.scope : "one"
    : "one";
  const label = (tx as any).type === "transfer"
    ? "Excluir transferência (par completo)"
    : `Excluir lançamento (${scope === "one" ? "esta parcela" : scope === "future" ? "esta e futuras" : "todas as parcelas"})`;
  const payload = {
    transaction_id: id,
    expected_version: (tx as any).version ?? 1,
    scope,
    before: { description: (tx as any).description, amount: Number((tx as any).amount), occurred_at: (tx as any).occurred_at },
  };
  const draftId = await upsertDraft(ctx, "transaction_delete", payload, label);
  if (!draftId) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: draftId, summary: label, transaction_id: id, scope } };
}

// ---------- Insights & highlights (read-only helpers) ----------

export async function get_daily_insights(ctx: ToolContext, args: { limit?: number }): Promise<ToolResult> {
  const limit = Math.max(1, Math.min(5, args?.limit ?? 3));
  const { data, error } = await ctx.sb
    .from("user_insights")
    .select("id,type,title,body,cta_label,cta_route,generated_at,evidence")
    .eq("user_id", ctx.user_id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message };
  const items = (data ?? []).map((r: any) => ({
    id: r.id, type: r.type, title: r.title, body: r.body,
    cta_label: r.cta_label, cta_route: r.cta_route,
    generated_at: r.generated_at,
  }));
  return { ok: true, result: { items, count: items.length } };
}

export async function get_spending_highlights(ctx: ToolContext): Promise<ToolResult> {
  const today = todaySaoPaulo();
  const now0 = new Date(`${today}T12:00:00-03:00`);
  const ym = today.slice(0, 7);
  const prevYm = shiftMonth(today, -1).slice(0, 7);
  const [txsCur, txsPrev, cats, goals, contribs] = await Promise.all([
    fetchTransactions(ctx, {
      select: "id,type,amount,category_id,occurred_at,status,transfer_group_id,description,account_id,payment_method,credit_card_id,settles_card_id,movement_kind",
      from: `${ym}-01`,
      status: "confirmed",
    }),
    fetchTransactions(ctx, {
      select: "id,type,amount,category_id,occurred_at,status,transfer_group_id,description,account_id,payment_method,credit_card_id,settles_card_id,movement_kind",
      from: `${prevYm}-01`,
      toExclusive: `${ym}-01`,
      status: "confirmed",
    }),
    ctx.sb.from("categories").select("id,name").or(`user_id.eq.${ctx.user_id},user_id.is.null`).is("archived_at", null),
    ctx.sb.from("goals").select("name,target_amount,target_date,status").eq("user_id", ctx.user_id).eq("status", "active"),
    ctx.sb.from("goal_contributions").select("goal_id,amount").eq("user_id", ctx.user_id),
  ]);
  for (const [source, response] of [["categories", cats], ["goals", goals], ["goal_contributions", contribs]] as const) {
    if (response.error) return { ok: false, error: `${source}_query_failed:${response.error.message}` };
  }
  const all = [...txsCur, ...txsPrev] as unknown as TransactionRow[];
  const catNames = new Map<string, string>();
  for (const c of (cats.data ?? []) as any[]) catNames.set(c.id, c.name);
  const signals = computeBehavioralSignals(
    all, catNames, (goals.data ?? []) as any[], (contribs.data ?? []) as any[], now0,
  );
  return { ok: true, result: signals };
}

export async function get_financial_snapshot(ctx: ToolContext): Promise<ToolResult> {
  try {
    const snap = await computeAgentSnapshot(ctx.sb, ctx.user_id);
    return { ok: true, result: snap };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function list_category_spending_goals(ctx: ToolContext): Promise<ToolResult> {
  try {
    const snap = await computeAgentSnapshot(ctx.sb, ctx.user_id);
    return { ok: true, result: { items: snap.active_category_goals, top: snap.top_category_goal, count: snap.active_category_goals.length } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function get_weekday_spending_pattern(ctx: ToolContext, args: {
  interpretation?: "typical_behavior" | "total_concentration" | "frequency" | "average_ticket";
  weeks?: number;
}): Promise<ToolResult> {
  try {
    const interpretation = args?.interpretation ?? "typical_behavior";
    const result = await executeWeekdayPattern({
      sb: ctx.sb,
      user_id: ctx.user_id,
      query: {
        domain: "behavior",
        intent: "weekday_pattern",
        interpretation,
        metric_key: interpretation === "typical_behavior" ? "weekday_typical_spend"
          : interpretation === "frequency" ? "weekday_purchase_frequency"
          : interpretation === "average_ticket" ? "weekday_average_ticket"
          : "weekday_total_concentration",
        output: "text",
        outlier_policy: interpretation === "typical_behavior" ? "exclude_for_typical" : "keep",
        period: { kind: "rolling_weeks", value: Math.max(4, Math.min(52, Number(args?.weeks ?? 12))) },
        correction: false,
        original_text: ctx.user_text ?? "",
      },
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function get_goals_overview(ctx: ToolContext): Promise<ToolResult> {
  try {
    const month = todaySaoPaulo().slice(0, 7);
    const [snap, goalsRes, contribsRes, investmentsRes, ownedSharedRes, memberRes, incomeRes] = await Promise.all([
      computeAgentSnapshot(ctx.sb, ctx.user_id),
      ctx.sb.from("goals").select("id,name,kind,status,target_amount,target_date,donation_mode,donation_percent,monthly_target,donation_income_scope,donation_income_category_ids").eq("user_id", ctx.user_id),
      ctx.sb.from("goal_contributions").select("goal_id,amount,occurred_at").eq("user_id", ctx.user_id),
      ctx.sb.from("investments").select("goal_id,current_value").eq("user_id", ctx.user_id),
      ctx.sb.from("shared_goals").select("id,title,target_amount,status,deadline").eq("created_by", ctx.user_id),
      ctx.sb.from("shared_goal_members").select("goal_id").eq("user_id", ctx.user_id).eq("invite_status", "accepted"),
      ctx.sb.from("transactions").select("amount,category_id,type,status,movement_kind,occurred_at").eq("user_id", ctx.user_id).eq("type", "income").eq("status", "confirmed").gte("occurred_at", `${month}-01`),
    ]);
    const sources: Array<[string, { error?: { message?: string } | null }]> = [
      ["goals", goalsRes], ["goal_contributions", contribsRes], ["investments", investmentsRes],
      ["shared_goals_owned", ownedSharedRes], ["shared_goal_members", memberRes], ["goal_income", incomeRes],
    ];
    for (const [source, response] of sources) {
      if (response.error) throw new Error(`goals_source_${source}:${response.error.message ?? "query_failed"}`);
    }
    const contributions = (contribsRes.data ?? []) as any[];
    const investments = (investmentsRes.data ?? []) as any[];
    const incomes = ((incomeRes.data ?? []) as any[])
      .filter((income) => isRealMonthlyMovement(income as TransactionRow))
      .map((income) => ({ ...income, amount: behavioralMetricAmount(income as TransactionRow, "income") }));
    const items = ((goalsRes.data ?? []) as any[]).map((goal) => {
      const contributed = contributions.filter((c) => c.goal_id === goal.id).reduce((sum, c) => sum + Number(c.amount || 0), 0);
      const invested = investments.filter((i) => i.goal_id === goal.id).reduce((sum, i) => sum + Number(i.current_value || 0), 0);
      const monthContributed = contributions.filter((c) => c.goal_id === goal.id && String(c.occurred_at).slice(0, 7) === month).reduce((sum, c) => sum + Number(c.amount || 0), 0);
      const scopedIncome = goal.donation_income_scope === "selected_categories"
        ? incomes.filter((i) => (goal.donation_income_category_ids ?? []).includes(i.category_id)).reduce((s, i) => s + Number(i.amount || 0), 0)
        : incomes.reduce((s, i) => s + Number(i.amount || 0), 0);
      const target = goal.kind === "donation"
        ? (goal.donation_mode === "income_percent" ? scopedIncome * Number(goal.donation_percent || 0) / 100 : Number(goal.monthly_target || goal.target_amount || 0))
        : Number(goal.target_amount || 0);
      const achieved = goal.kind === "donation" ? monthContributed : contributed + invested;
      return {
        id: goal.id, name: goal.name, type: goal.kind ?? "savings", status: goal.status,
        target: Math.round(target * 100) / 100,
        achieved: Math.round(achieved * 100) / 100,
        attainment_pct: target > 0 ? Math.min(100, Math.round(achieved / target * 10000) / 100) : 0,
        remaining: Math.max(0, Math.round((target - achieved) * 100) / 100),
        target_date: goal.target_date,
      };
    });
    const categoryItems = snap.active_category_goals.map((goal) => ({
      id: goal.goal_id, name: goal.category_name ?? "Categoria", type: "category", status: goal.status,
      target: goal.target_amount, achieved: goal.actual_spend,
      attainment_pct: goal.actual_spend <= goal.target_amount ? 100 : Math.max(0, Math.round(goal.target_amount / Math.max(1, goal.actual_spend) * 10000) / 100),
      remaining: goal.remaining_amount,
    }));
    const memberGoalIds = [...new Set(((memberRes.data ?? []) as any[]).map((m) => m.goal_id).filter(Boolean))];
    const memberSharedRes = memberGoalIds.length
      ? await ctx.sb.from("shared_goals").select("id,title,target_amount,status,deadline").in("id", memberGoalIds)
      : { data: [] as any[], error: null };
    if (memberSharedRes.error) throw new Error(`goals_source_shared_goals_member:${memberSharedRes.error.message}`);
    const sharedById = new Map<string, any>();
    for (const goal of [...((ownedSharedRes.data ?? []) as any[]), ...((memberSharedRes.data ?? []) as any[])]) {
      sharedById.set(goal.id, goal);
    }
    return {
      ok: true,
      result: {
        formula_version: "goals_overview.v2",
        month,
        items,
        category_goals: categoryItems,
        shared_goals: [...sharedById.values()],
        overall_attainment_pct: [...items, ...categoryItems].length
          ? Math.round([...items, ...categoryItems].reduce((sum, item) => sum + Number(item.attainment_pct || 0), 0) / [...items, ...categoryItems].length * 100) / 100
          : 0,
      },
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function create_split_expense_draft(ctx: ToolContext, args: {
  title: string; total: number; occurred_at?: string; due_date?: string;
  split_mode?: "equal" | "custom"; include_owner?: boolean;
  participants: Array<{ name: string; phone_e164?: string; amount_due?: number }>;
  account?: string; card?: string; category?: string; owner_amount?: number;
  reminder_enabled?: boolean; pix_key?: string;
}): Promise<ToolResult> {
  const title = String(args?.title ?? "").trim();
  const total = Number(args?.total);
  const participants = Array.isArray(args?.participants) ? args.participants.filter((p) => String(p?.name ?? "").trim()) : [];
  if (!title) return { ok: false, error: "invalid_title" };
  if (!Number.isFinite(total) || total <= 0) return { ok: false, error: "invalid_amount" };
  if (!participants.length) return { ok: false, error: "participants_required" };
  if (!args.account && !args.card) return { ok: false, error: "payment_source_required" };
  if (args.account && args.card) return { ok: false, error: "choose_single_payment_source" };
  const account = args.account ? await resolveAccountId(ctx, args.account) : null;
  if (args.account && !account) return { ok: false, error: "account_not_found" };
  const card = args.card ? await resolveCreditCardFull(ctx, args.card) : null;
  if (args.card && card?.kind !== "single") return { ok: false, error: "card_not_found", result: card };
  const categoryId = await resolveCategoryId(ctx, args.category, "expense");
  if (args.category && !categoryId) return { ok: false, error: "category_not_found" };
  const occurredAt = resolveOccurredAt({ text: ctx.user_text, modelValue: args.occurred_at ?? null }).iso;
  const splitMode = args.split_mode ?? "equal";
  if (splitMode === "custom") {
    const parts = participants.reduce((sum, p) => sum + Number(p.amount_due || 0), 0) + (args.include_owner === false ? 0 : Number(args.owner_amount || 0));
    if (Math.abs(parts - total) > 0.009) return { ok: false, error: "custom_split_total_mismatch", details: { expected: total, received: parts } };
  }
  const payload = {
    title, total, occurred_at: occurredAt,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(args.due_date ?? "") ? args.due_date : null,
    split_mode: splitMode, include_owner: args.include_owner !== false,
    participants: participants.map((p) => ({ name: String(p.name).trim(), phone_e164: p.phone_e164 ?? null, amount_due: p.amount_due ?? null })),
    owner_amount: args.owner_amount ?? null,
    source_account_id: account?.id ?? null,
    source_credit_card_id: card?.kind === "single" ? card.id : null,
    reimbursement_account_id: account?.id ?? null,
    category_id: categoryId,
    reminder_enabled: Boolean(args.reminder_enabled), pix_key: args.pix_key ?? null,
  };
  const summary = `Rolê “${title}” de ${BRL.format(total)} para dividir com ${participants.length} pessoa${participants.length > 1 ? "s" : ""}, em ${occurredAt}.`;
  const id = await upsertDraft(ctx, "shared_expense", payload, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary, participants: participants.length } };
}



// ---------- Registry (name → executor + JSON Schema) ----------

// ---------- Motor analítico (compare, forecast, attribute, goals, artifact) ----------

import { computeCompare, type CompareInput } from "../analytics/compare.ts";
import { computeAttribution } from "../analytics/attribute.ts";
import { projectGoal, simulatePace } from "../analytics/goals.ts";
import { computeDailySpend } from "../analytics/timeseries.ts";
import { computeCumulativeDailyAverage } from "../analytics/dailyAverage.ts";
import { monthRange, shiftMonth, todaySP } from "../analytics/periods.ts";
import {
  buildCompareArtifact, buildForecastArtifact, buildGoalArtifact,
  buildTimeseriesArtifact, buildCumulativeDailyAverageArtifact,
  type ChartArtifact,
} from "../artifacts/builder.ts";
import { reconciliationGate } from "../engine/reconciliation.ts";
import { templateToArtifactArgs, TEMPLATE_KEYS, type TemplateKey } from "./templates/reportTemplates.ts";
import { parseTemplateArgs } from "./templates/templateSchemas.ts";

async function loadTxAndCategories(ctx: ToolContext, from: string, to: string) {
  const [txs, categoriesResult] = await Promise.all([
    fetchTransactions(ctx, {
      select: "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind",
      from,
      to,
    }),
    ctx.sb.from("categories").select("id,name").or(`user_id.eq.${ctx.user_id},user_id.is.null`).is("archived_at", null),
  ]);
  if (categoriesResult.error) throw new Error(`categories_query_failed:${categoriesResult.error.message}`);
  const cats = categoriesResult.data;
  const names = new Map<string, string>((cats ?? []).map((c: any) => [c.id, c.name]));
  const rows = (txs ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }));
  return { txs: rows, names };
}

export async function compare_periods(ctx: ToolContext, args: {
  metric?: "expense" | "income"; period_a?: { from: string; to: string }; period_b?: { from: string; to: string };
}): Promise<ToolResult> {
  const today = todaySP();
  const cur = monthRange(today);
  const prev = monthRange(shiftMonth(today, -1));
  const period_a = args?.period_a ?? { from: prev.from, to: prev.to };
  const period_b = args?.period_b ?? { from: cur.from, to: today };
  const metric = (args?.metric ?? "expense") as "expense" | "income";
  // carrega janela unificada
  const from = period_a.from < period_b.from ? period_a.from : period_b.from;
  const to = period_a.to > period_b.to ? period_a.to : period_b.to;
  const { txs, names } = await loadTxAndCategories(ctx, from, to);
  const gate = reconciliationGate(txs as any);
  if (!gate.ok) { const g = gate as { ok: false; error: string; violations: unknown }; return { ok: false, error: g.error, violations: g.violations }; }
  const result = computeCompare({ txs: txs as any, categoryNames: names, metric, period_a, period_b, group_by: "category" });
  return { ok: true, result };
}

export async function forecast_month_close(ctx: ToolContext, args: { model?: "auto" | "baseline" | "observed" | "seasonal" }): Promise<ToolResult> {
  // O fechamento não mantém um segundo estimador legado. Home, WhatsApp e App
  // consomem exatamente o mesmo snapshot financeiro reconciliado.
  const snapshot = await computeAgentSnapshot(ctx.sb, ctx.user_id);
  const committedFuture = snapshot.known_future_commitments + snapshot.card_due_this_month;
  const point = Math.round((snapshot.current_month_expense
    + snapshot.projected_remaining_consumption
    + committedFuture) * 100) / 100;
  const daysInMonth = snapshot.days_elapsed + snapshot.days_remaining;
  const rowCount = snapshot.source_transaction_count;
  const bridgeConfidence = snapshot.cash_bridge.confidence;
  const confidence = bridgeConfidence === "high" || bridgeConfidence === "medium" || bridgeConfidence === "low"
    ? bridgeConfidence
    : "insufficient_data";
  return { ok: true, result: {
    month: snapshot.month_start.slice(0, 7),
    point,
    low: null,
    high: null,
    model_used: "financial_snapshot_contract.v8",
    drivers: {
      mtd_expense: snapshot.current_month_expense,
      day_of_month: snapshot.days_elapsed,
      days_in_month: daysInMonth,
      recurring_future: committedFuture,
      seasonal_adjust: 0,
    },
    backtest_summary: null,
    provenance: makeProvenance({
      from: snapshot.month_start,
      to: snapshot.month_end,
      row_count: rowCount,
      formula_version: snapshot.formula_version,
      confidence,
      maturity: { days_observed: snapshot.days_elapsed, days_in_month: daysInMonth },
      notes: [
        "Mesmo contrato reconciliado usado pela Home e pelo assessor.",
        "Inclui consumo projetado, compromissos conhecidos e fatura a vencer no mês.",
      ],
    }),
    projected_month_end_available: snapshot.projected_month_end_available,
    confirmed_future_income: snapshot.confirmed_future_income,
    estimated_fixed_income: snapshot.estimated_fixed_income,
    estimated_income_events: snapshot.estimated_income_events,
    reconciliation_id: snapshot.reconciliation_id,
  } };
}

export async function explain_spending_change(ctx: ToolContext, args: {
  period_a?: { from: string; to: string }; period_b?: { from: string; to: string };
}): Promise<ToolResult> {
  const cmp = await compare_periods(ctx, { metric: "expense", period_a: args?.period_a, period_b: args?.period_b });
  if (!cmp.ok) return cmp;
  const attribution = computeAttribution(cmp.result);
  return { ok: true, result: { compare: cmp.result, attribution } };
}

export async function project_goal_completion(ctx: ToolContext, args: { goal_id?: string; goal?: string }): Promise<ToolResult> {
  let goalRow: any = null;
  if (args?.goal_id && /^[0-9a-f-]{36}$/i.test(args.goal_id)) {
    const { data, error } = await ctx.sb.from("goals").select("id,name,target_amount,target_date,status").eq("user_id", ctx.user_id).eq("id", args.goal_id).maybeSingle();
    if (error) return { ok: false, error: `goals_query_failed:${error.message}` };
    goalRow = data;
  } else if (args?.goal) {
    const { data, error } = await ctx.sb.from("goals").select("id,name,target_amount,target_date,status").eq("user_id", ctx.user_id).ilike("name", `%${args.goal}%`).limit(1);
    if (error) return { ok: false, error: `goals_query_failed:${error.message}` };
    goalRow = data && data[0];
  } else {
    const { data, error } = await ctx.sb.from("goals").select("id,name,target_amount,target_date,status").eq("user_id", ctx.user_id).eq("status", "active").order("created_at").limit(1);
    if (error) return { ok: false, error: `goals_query_failed:${error.message}` };
    goalRow = data && data[0];
  }
  if (!goalRow) return { ok: false, error: "goal_not_found" };
  const { data: contribs, error: contributionsError } = await ctx.sb.from("goal_contributions").select("amount,occurred_at").eq("user_id", ctx.user_id).eq("goal_id", goalRow.id);
  if (contributionsError) return { ok: false, error: `goal_contributions_query_failed:${contributionsError.message}` };
  const projection = projectGoal({
    goal: { id: goalRow.id, name: goalRow.name, target_amount: Number(goalRow.target_amount || 0), target_date: goalRow.target_date, status: goalRow.status },
    contributions: (contribs ?? []).map((c: any) => ({ amount: Number(c.amount), occurred_at: c.occurred_at })),
  });
  return { ok: true, result: projection };
}

export async function simulate_goal_pace(ctx: ToolContext, args: { goal_id?: string; goal?: string; monthly_contribution: number }): Promise<ToolResult> {
  const proj = await project_goal_completion(ctx, args);
  if (!proj.ok) return proj;
  const { data: contribs, error: contributionsError } = await ctx.sb.from("goal_contributions").select("amount,occurred_at").eq("user_id", ctx.user_id).eq("goal_id", proj.result.goal_id);
  if (contributionsError) return { ok: false, error: `goal_contributions_query_failed:${contributionsError.message}` };
  const scenario = simulatePace({
    goal: { id: proj.result.goal_id, name: proj.result.name, target_amount: proj.result.target, target_date: null },
    contributions: (contribs ?? []).map((c: any) => ({ amount: Number(c.amount), occurred_at: c.occurred_at })),
  }, Number(args.monthly_contribution || 0));
  return { ok: true, result: { ...scenario, monthly_contribution: Number(args.monthly_contribution || 0), goal_id: proj.result.goal_id } };
}

export async function spending_timeseries_daily(ctx: ToolContext, args: {
  metric?: "expense" | "income";
  from?: string;
  to?: string;
  days?: number;
}): Promise<ToolResult> {
  const today = todaySP();
  const cur = monthRange(today);
  let from = args?.from;
  let to = args?.to ?? today;
  if (!from) {
    if (args?.days && args.days > 0) {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (Math.min(366, args.days) - 1));
      from = d.toISOString().slice(0, 10);
    } else {
      from = cur.from;
    }
  }
  const { txs } = await loadTxAndCategories(ctx, from, to);
  const gate = reconciliationGate(txs as any);
  if (!gate.ok) { const g = gate as { ok: false; error: string; violations: unknown }; return { ok: false, error: g.error, violations: g.violations }; }
  const result = computeDailySpend({ txs: txs as any, metric: args?.metric ?? "expense", from, to });
  return { ok: true, result };
}

export async function spending_average_daily_trend(ctx: ToolContext, args: {
  from?: string;
  to?: string;
}): Promise<ToolResult> {
  const today = todaySP();
  const cur = monthRange(today);
  const from = args?.from ?? cur.from;
  const to = args?.to ?? today;
  const { txs } = await loadTxAndCategories(ctx, from, to);
  const gate = reconciliationGate(txs as any);
  if (!gate.ok) { const g = gate as { ok: false; error: string; violations: unknown }; return { ok: false, error: g.error, violations: g.violations }; }
  const result = computeCumulativeDailyAverage({ txs: txs as any, from, to });
  return { ok: true, result };
}

export async function generate_chart_artifact(ctx: ToolContext, args: {
  kind: "compare" | "forecast" | "goal" | "timeseries" | "average_daily_trend";
  goal_id?: string;
  goal?: string;
  metric?: "expense" | "income";
  period_a?: { from: string; to: string };
  period_b?: { from: string; to: string };
  from?: string;
  to?: string;
  days?: number;
}): Promise<ToolResult> {
  let artifact: ChartArtifact | null = null;

  if (args.kind === "forecast") {
    const r = await forecast_month_close(ctx, {});
    if (!r.ok) return r;
    artifact = buildForecastArtifact(r.result);
  } else if (args.kind === "goal") {
    const r = await project_goal_completion(ctx, { goal_id: args.goal_id, goal: args.goal });
    if (!r.ok) return r;
    artifact = buildGoalArtifact(r.result);
  } else if (args.kind === "timeseries") {
    const r = await spending_timeseries_daily(ctx, {
      metric: args.metric ?? "expense", from: args.from, to: args.to, days: args.days,
    });
    if (!r.ok) return r;
    artifact = buildTimeseriesArtifact(r.result);
  } else if (args.kind === "average_daily_trend") {
    const r = await spending_average_daily_trend(ctx, { from: args.from, to: args.to });
    if (!r.ok) return r;
    artifact = buildCumulativeDailyAverageArtifact(r.result);
  } else {
    const r = await compare_periods(ctx, { metric: args.metric ?? "expense", period_a: args.period_a, period_b: args.period_b });
    if (!r.ok) return r;
    artifact = buildCompareArtifact(r.result);
  }

  // Persistência do artefato para reuso/entrega em outros canais
  const { data: saved, error: saveError } = await ctx.sb.from("agent_artifacts").insert({
    user_id: ctx.user_id,
    conversation_id: ctx.conversation_id,
    kind: artifact.kind,
    payload: artifact as any,
    formula_version: artifact.provenance.formula_version,
  }).select("id").maybeSingle();
  if (saveError) return { ok: false, error: `artifact_persistence_failed:${saveError.message}` };

  return { ok: true, result: { artifact, artifact_id: saved?.id ?? null } };
}

// generate_report_from_template — bypass determinístico para templates ativos
// em public.financial_report_templates. Recebe template_key + params e delega
// para generate_chart_artifact usando o mapeamento canônico.

export async function generate_report_from_template(ctx: ToolContext, args: {
  template_key: TemplateKey;
  params?: Record<string, unknown>;
}): Promise<ToolResult> {
  const parsed = parseTemplateArgs(args?.template_key as string, args?.params);
  if (!parsed.ok) {
    const p = parsed as { ok: false; error: string; details?: unknown };
    return { ok: false, error: p.error, details: p.details };
  }
  // Confirma que o template está ativo no banco (fonte de verdade).
  const { data: tpl, error: templateError } = await ctx.sb
    .from("financial_report_templates")
    .select("template_key, active")
    .eq("template_key", parsed.value.template_key)
    .maybeSingle();
  if (templateError) return { ok: false, error: `report_template_query_failed:${templateError.message}` };
  if (!tpl || !tpl.active) return { ok: false, error: "template_inactive" };

  const { kind, args: mappedArgs } = templateToArtifactArgs(parsed.value);
  return await generate_chart_artifact(ctx, { kind: kind as any, ...(mappedArgs as any) });
}

// ---------- Registro ----------

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (ctx: ToolContext, args: any) => Promise<ToolResult>;
};

const requiredStr = { type: "string" };
const optionalStr = { type: "string" };
const num = { type: "number" };

const periodSchema = {
  type: "object",
  properties: { from: { type: "string" }, to: { type: "string" } },
  required: ["from", "to"],
  additionalProperties: false,
};

// ---------- Shared Goals (Metas Conjuntas) ----------

async function visibleSharedGoals(ctx: ToolContext): Promise<any[]> {
  const [{ data: owned, error: ownedError }, { data: memberships, error: memberError }] = await Promise.all([
    ctx.sb.from("shared_goals")
      .select("id,title,target_amount,deadline,created_by,status,created_at")
      .eq("created_by", ctx.user_id),
    ctx.sb.from("shared_goal_members").select("goal_id")
      .eq("user_id", ctx.user_id).eq("invite_status", "accepted"),
  ]);
  if (ownedError) throw new Error(ownedError.message);
  if (memberError) throw new Error(memberError.message);
  const memberIds = [...new Set(((memberships ?? []) as any[]).map((m) => m.goal_id).filter(Boolean))];
  const { data: memberGoals, error: memberGoalsError } = memberIds.length
    ? await ctx.sb.from("shared_goals")
      .select("id,title,target_amount,deadline,created_by,status,created_at").in("id", memberIds)
    : { data: [] as any[], error: null };
  if (memberGoalsError) throw new Error(memberGoalsError.message);
  const unique = new Map<string, any>();
  for (const goal of [...((owned ?? []) as any[]), ...((memberGoals ?? []) as any[])]) unique.set(goal.id, goal);
  return [...unique.values()].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

async function resolveSharedGoal(ctx: ToolContext, hint: string): Promise<{ id: string; title: string; target_amount: number; deadline: string | null } | null> {
  const h = String(hint ?? "").trim();
  if (!h) return null;
  const data = await visibleSharedGoals(ctx);
  const low = h.toLowerCase();
  const m = /^[0-9a-f-]{36}$/i.test(h)
    ? data.find((g: any) => g.id === h)
    : data.find((g: any) => String(g.title ?? "").toLowerCase().includes(low));
  return m ? { id: m.id, title: m.title, target_amount: Number(m.target_amount), deadline: m.deadline } : null;
}

export async function list_shared_goals(ctx: ToolContext): Promise<ToolResult> {
  try {
    return { ok: true, result: { goals: (await visibleSharedGoals(ctx)).slice(0, 20) } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function get_shared_goal_progress(ctx: ToolContext, args: { goal?: string; goal_id?: string }): Promise<ToolResult> {
  let g;
  try {
    g = await resolveSharedGoal(ctx, args.goal_id ?? args.goal ?? "");
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (!g) return { ok: false, error: "goal_not_found" };
  const { data: contribs, error: contributionsError } = await ctx.sb
    .from("shared_goal_contributions")
    .select("user_id, amount, occurred_at")
    .eq("goal_id", g.id);
  if (contributionsError) return { ok: false, error: `shared_goal_contributions_query_failed:${contributionsError.message}` };
  const total = (contribs ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const ranking = new Map<string, number>();
  for (const r of contribs ?? []) {
    ranking.set(r.user_id, (ranking.get(r.user_id) ?? 0) + Number(r.amount ?? 0));
  }
  const rankingArr = Array.from(ranking.entries())
    .map(([user_id, amount]) => ({ user_id, amount }))
    .sort((a, b) => b.amount - a.amount);
  return {
    ok: true,
    result: {
      goal: g,
      total_contributed: total,
      remaining: Math.max(0, Number(g.target_amount) - total),
      progress_pct: g.target_amount > 0 ? Math.min(100, (total / Number(g.target_amount)) * 100) : 0,
      ranking: rankingArr,
    },
  };
}

export async function simulate_shared_goal_pace(ctx: ToolContext, args: { goal?: string; goal_id?: string; monthly_contribution: number }): Promise<ToolResult> {
  let g;
  try {
    g = await resolveSharedGoal(ctx, args.goal_id ?? args.goal ?? "");
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (!g) return { ok: false, error: "goal_not_found" };
  const monthly = Number(args.monthly_contribution);
  if (!Number.isFinite(monthly) || monthly <= 0) return { ok: false, error: "invalid_amount" };
  const { data: contribs, error: contributionsError } = await ctx.sb
    .from("shared_goal_contributions").select("amount").eq("goal_id", g.id);
  if (contributionsError) return { ok: false, error: `shared_goal_contributions_query_failed:${contributionsError.message}` };
  const total = (contribs ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const remaining = Math.max(0, Number(g.target_amount) - total);
  const months = remaining > 0 ? Math.ceil(remaining / monthly) : 0;
  const projected = new Date();
  projected.setMonth(projected.getMonth() + months);
  return {
    ok: true,
    result: {
      goal_id: g.id, title: g.title,
      remaining, monthly_contribution: monthly, months_to_complete: months,
      projected_completion: projected.toISOString().slice(0, 10),
      deadline: g.deadline,
    },
  };
}

export async function create_shared_goal_draft(ctx: ToolContext, args: {
  title: string; target_amount: number; deadline?: string;
}): Promise<ToolResult> {
  const title = String(args?.title ?? "").trim();
  const target = Number(args?.target_amount);
  if (!title) return { ok: false, error: "invalid_title" };
  if (!Number.isFinite(target) || target <= 0) return { ok: false, error: "invalid_amount" };
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(args.deadline ?? "") ? args.deadline : null;
  const summary = `Meta conjunta “${title}” com objetivo de ${BRL.format(target)}${deadline ? ` até ${deadline}` : ""}.`;
  const id = await upsertDraft(ctx, "shared_goal_create", { title, target_amount: target, deadline }, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function add_shared_goal_contribution_draft(ctx: ToolContext, args: {
  goal: string; amount: number; occurred_at?: string; note?: string;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const g = await resolveSharedGoal(ctx, args.goal ?? "");
  if (!g) return { ok: false, error: "goal_not_found" };
  const occurred_at = resolveOccurredAt({ text: ctx.user_text, modelValue: args.occurred_at ?? null }).iso;
  const summary = `Contribuição de ${BRL.format(amount)} para meta conjunta “${g.title}” em ${occurred_at}.`;
  const id = await upsertDraft(ctx, "shared_goal_contribution", {
    goal_id: g.id, amount, occurred_at, note: args.note ?? null,
  }, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function explain_shared_goal_ranking(ctx: ToolContext, args: { goal?: string; goal_id?: string }): Promise<ToolResult> {
  const progress = await get_shared_goal_progress(ctx, args);
  if (!progress.ok) return progress;
  const { ranking, goal, total_contributed } = (progress as any).result;
  const top = (ranking as any[]).slice(0, 3);
  return {
    ok: true,
    result: {
      goal_id: goal.id, title: goal.title,
      total_contributed, top_contributors: top,
      remaining: Math.max(0, Number(goal.target_amount) - Number(total_contributed)),
    },
  };
}

export const AGENT_TOOLS: ToolSpec[] = [

  {
    name: "list_accounts",
    description: "Lista as contas ativas do usuário.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: list_accounts,
  },
  {
    name: "list_categories",
    description: "Lista categorias globais e pessoais, opcionalmente filtradas por tipo.",
    parameters: { type: "object", properties: { type: { type: "string", enum: ["income", "expense"] } }, additionalProperties: false },
    execute: list_categories,
  },
  {
    name: "get_financial_summary",
    description: "Retorna entradas, saídas e saldo do período do mês corrente.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: get_financial_summary,
  },
  {
    name: "list_recent_transactions",
    description: "Lista os lançamentos mais recentes do usuário.",
    parameters: { type: "object", properties: { limit: { type: "integer" } }, additionalProperties: false },
    execute: list_recent_transactions,
  },
  {
    name: "analyze_spending",
    description: "APENAS respostas TEXTUAIS de resumo/onde mais gastou (mesma definição de consumo real da Home: exclui aplicações, aportes, transferências, pagamento de fatura). NUNCA use quando o usuário pedir gráfico, visualização, tendência, evolução, 'dia a dia', média diária ou 'estou reduzindo' — nesses casos chame generate_chart_artifact.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 366 },
        from: optionalStr, to: optionalStr,
        payment_method: { type: "string", enum: ["account", "credit_card"] },
      },
      additionalProperties: false,
    },
    execute: analyze_spending,
  },
  {
    name: "get_spending_for_date",
    description: "Retorna o gasto real de uma data comportamental específica. Considera a data da compra/automação e evita atribuir à segunda-feira lançamentos apenas postados pelo banco.",
    parameters: {
      type: "object",
      properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
      required: ["date"], additionalProperties: false,
    },
    execute: get_spending_for_date,
  },
  {
    name: "run_before_spending",
    description: "Simula um gasto futuro usando o mesmo snapshot financeiro da Home. Considere data, categoria, meio de pagamento, cartão e parcelas; devolve impacto no caixa, fechamento do mês e meta da categoria.",
    parameters: {
      type: "object",
      properties: {
        amount: num, account_hint: optionalStr, category: optionalStr,
        planned_date: optionalStr,
        method: { type: "string", enum: ["cash", "card"] },
        card: optionalStr,
        installments: { type: "integer", minimum: 1, maximum: 48 },
      },
      required: ["amount", "planned_date"], additionalProperties: false,
    },
    execute: run_before_spending,
  },
  {
    name: "get_goals_overview",
    description: "Retorna uma visão consolidada e calculada das metas financeiras, de categoria, de doação e conjuntas do usuário, com alvo, realizado, restante e percentual de atingimento.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: get_goals_overview,
  },
  {
    name: "get_weekday_spending_pattern",
    description: "Responde qual dia da semana concentra o comportamento de gasto do usuário. Usa data comportamental com confiança, separa picos e não confunde postagem bancária de segunda-feira com o dia real da compra.",
    parameters: {
      type: "object",
      properties: {
        interpretation: { type: "string", enum: ["typical_behavior", "total_concentration", "frequency", "average_ticket"] },
        weeks: { type: "integer", minimum: 4, maximum: 52 },
      },
      additionalProperties: false,
    },
    execute: get_weekday_spending_pattern,
  },
  {
    name: "create_split_expense_draft",
    description: "Cria um RASCUNHO de divisão de rolê. Conduza a conversa pedindo somente os campos faltantes: título, valor, data, pessoas, fonte do pagamento e divisão igual/personalizada. Nunca confirme sem CONFIRMAR do usuário.",
    parameters: {
      type: "object",
      properties: {
        title: requiredStr, total: num, occurred_at: optionalStr, due_date: optionalStr,
        split_mode: { type: "string", enum: ["equal", "custom"] },
        include_owner: { type: "boolean" },
        participants: {
          type: "array", minItems: 1,
          items: { type: "object", properties: { name: requiredStr, phone_e164: optionalStr, amount_due: num }, required: ["name"], additionalProperties: false },
        },
        account: optionalStr, card: optionalStr, category: optionalStr,
        owner_amount: num, reminder_enabled: { type: "boolean" }, pix_key: optionalStr,
      },
      required: ["title", "total", "participants"], additionalProperties: false,
    },
    execute: create_split_expense_draft,
  },
  {
    name: "list_credit_cards",
    description: "Lista os cartões de crédito ativos do usuário.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: list_credit_cards,
  },
  {
    name: "create_transaction_draft",
    description: "Cria uma proposta de lançamento (receita ou despesa) aguardando CONFIRMAR. Use 'account' para conta comum OU 'credit_card' para despesa em cartão. Não misture os dois.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["income", "expense"] },
        amount: num,
        account: optionalStr,
        credit_card: optionalStr,
        installments_total: { type: "integer" },
        category: optionalStr, occurred_at: optionalStr, description: optionalStr,
      },
      required: ["type", "amount"], additionalProperties: false,
    },
    execute: create_transaction_draft,
  },
  {
    name: "create_transfer_draft",
    description: "Cria uma proposta de transferência entre duas contas do usuário.",
    parameters: {
      type: "object",
      properties: { amount: num, from_account: requiredStr, to_account: requiredStr, occurred_at: optionalStr, description: optionalStr },
      required: ["amount", "from_account", "to_account"], additionalProperties: false,
    },
    execute: create_transfer_draft,
  },
  {
    name: "pay_credit_card_bill_draft",
    description: "Cria uma proposta de PAGAMENTO DE FATURA de cartão de crédito. Debita a conta informada e liquida o cartão. NÃO conta como consumo do mês.",
    parameters: {
      type: "object",
      properties: {
        amount: num,
        account: requiredStr,
        card: requiredStr,
        occurred_at: optionalStr,
        description: optionalStr,
      },
      required: ["amount", "account", "card"], additionalProperties: false,
    },
    execute: pay_credit_card_bill_draft,
  },
  {
    name: "create_goal_draft",
    description: "Cria uma proposta de meta financeira.",
    parameters: {
      type: "object",
      properties: { name: requiredStr, target_amount: num, target_date: optionalStr, priority: { type: "integer" } },
      required: ["name", "target_amount"], additionalProperties: false,
    },
    execute: create_goal_draft,
  },
  {
    name: "add_goal_contribution_draft",
    description: "Cria uma proposta de aporte em uma meta existente do usuário.",
    parameters: {
      type: "object",
      properties: { goal: requiredStr, amount: num, occurred_at: optionalStr, account: optionalStr },
      required: ["goal", "amount"], additionalProperties: false,
    },
    execute: add_goal_contribution_draft,
  },
  {
    name: "create_debt_draft",
    description: "Cria uma proposta de dívida.",
    parameters: {
      type: "object",
      properties: {
        name: requiredStr, original_amount: num,
        outstanding_balance: num, installment_amount: num,
        due_day: { type: "integer" }, creditor: optionalStr,
      },
      required: ["name", "original_amount"], additionalProperties: false,
    },
    execute: create_debt_draft,
  },
  {
    name: "confirm_pending_action",
    description: "Confirma e executa o rascunho pendente na conversa atual. Use quando o usuário responder sim/ok/pode/confirmar a uma pendência ativa.",
    parameters: { type: "object", properties: { id: optionalStr }, additionalProperties: false },
    execute: confirm_pending_action,
  },
  {
    name: "cancel_pending_action",
    description: "Cancela o rascunho pendente na conversa atual, se houver.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: cancel_pending_action,
  },
  {
    name: "search_transactions",
    description: "Busca lançamentos do usuário por texto na descrição e/ou por período/tipo. Use antes de editar/excluir para achar o ID exato.",
    parameters: {
      type: "object",
      properties: {
        query: optionalStr,
        days: { type: "integer" },
        type: { type: "string", enum: ["income", "expense", "transfer"] },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
    execute: search_transactions,
  },
  {
    name: "get_transaction",
    description: "Retorna todos os campos de um lançamento pelo ID, se pertencer ao usuário.",
    parameters: {
      type: "object",
      properties: { transaction_id: requiredStr },
      required: ["transaction_id"], additionalProperties: false,
    },
    execute: get_transaction,
  },
  {
    name: "draft_transaction_update",
    description: "Cria uma proposta de EDIÇÃO de um lançamento existente. Campos aceitos em patch: description, category (texto), amount, occurred_at, notes, payment_method ('account'|'credit_card'), account (texto ou id), credit_card (texto ou id). Para parcelamentos, use scope 'one' (padrão), 'future' ou 'all'. Aguarda CONFIRMAR.",
    parameters: {
      type: "object",
      properties: {
        transaction_id: requiredStr,
        patch: {
          type: "object",
          properties: {
            description: { type: ["string", "null"] },
            category: { type: ["string", "null"] },
            amount: num,
            occurred_at: optionalStr,
            notes: { type: ["string", "null"] },
            payment_method: { type: "string", enum: ["account", "credit_card"] },
            account: { type: ["string", "null"] },
            credit_card: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
        scope: { type: "string", enum: ["one", "future", "all"] },
      },
      required: ["transaction_id", "patch"], additionalProperties: false,
    },
    execute: draft_transaction_update,
  },
  {
    name: "draft_transaction_delete",
    description: "Cria uma proposta de EXCLUSÃO de um lançamento. Transferências sempre excluem o par. Aguarda CONFIRMAR.",
    parameters: {
      type: "object",
      properties: {
        transaction_id: requiredStr,
        scope: { type: "string", enum: ["one", "future", "all"] },
      },
      required: ["transaction_id"], additionalProperties: false,
    },
    execute: draft_transaction_delete,
  },
  {
    name: "get_daily_insights",
    description: "Lista as dicas/insights ativos do usuário (as mesmas exibidas na Home). Use quando o usuário pedir 'dicas', 'insights', 'sugestões', 'o que a IA acha' ou similar.",
    parameters: { type: "object", properties: { limit: { type: "integer" } }, additionalProperties: false },
    execute: get_daily_insights,
  },
  {
    name: "get_spending_highlights",
    description: "Retorna sinais comportamentais do mês: categoria líder e %, categoria que mais cresceu vs mês anterior, dia da semana concentrado, estabelecimento repetido, dias sem lançar e ritmo da meta. Use para responder 'o que mudou', 'onde estou gastando mais', 'estou no ritmo da meta', 'me analisa'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: get_spending_highlights,
  },
  {
    name: "get_financial_snapshot",
    description: "Retorna o mesmo painel que a Home mostra: disponível hoje, ritmo de gasto, projeção de fim de mês, entradas e compromissos futuros conhecidos, fatura em aberto e metas de categoria ativas. Use quando o usuário pedir 'como estou?', 'quanto sobra até o fim do mês?', 'projeção', 'ritmo', 'quanto gastei/quanto entrou este mês'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: get_financial_snapshot,
  },
  {
    name: "list_category_spending_goals",
    description: "Lista as metas de controle de gasto por categoria, com limite, gasto atual, ritmo diário permitido, projeção de estouro e status (no_ritmo, atencao, em_risco, estourou). Use quando o usuário perguntar por uma meta de gasto específica ou 'minhas metas de categoria'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: list_category_spending_goals,
  },
  {
    name: "compare_periods",
    description: "Compara gasto (ou receita) entre dois períodos, com quebra por categoria e delta absoluto/percentual. Se períodos não forem informados, compara mês anterior x mês atual até hoje. Retorna provenance com confiança.",
    parameters: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["expense", "income"] },
        period_a: periodSchema,
        period_b: periodSchema,
      },
      additionalProperties: false,
    },
    execute: compare_periods,
  },
  {
    name: "forecast_month_close",
    description: "Prevê o fechamento do mês corrente combinando gasto até hoje, compromissos recorrentes e sazonalidade quando houver histórico >=6 meses. Sempre devolve confiança e backtest quando possível.",
    parameters: {
      type: "object",
      properties: { model: { type: "string", enum: ["auto", "baseline", "observed", "seasonal"] } },
      additionalProperties: false,
    },
    execute: forecast_month_close,
  },
  {
    name: "explain_spending_change",
    description: "Explica quais categorias explicam a variação do gasto entre dois períodos (decomposição causal descritiva, não afirmação de causa).",
    parameters: {
      type: "object",
      properties: { period_a: periodSchema, period_b: periodSchema },
      additionalProperties: false,
    },
    execute: explain_spending_change,
  },
  {
    name: "project_goal_completion",
    description: "Projeta a data de conclusão de uma meta a partir dos aportes observados nos últimos 90 dias. Devolve ritmo necessário x observado e dias de antecipação/atraso.",
    parameters: {
      type: "object",
      properties: { goal_id: optionalStr, goal: optionalStr },
      additionalProperties: false,
    },
    execute: project_goal_completion,
  },
  {
    name: "simulate_goal_pace",
    description: "Simula a data de conclusão de uma meta considerando um aporte mensal hipotético.",
    parameters: {
      type: "object",
      properties: { goal_id: optionalStr, goal: optionalStr, monthly_contribution: num },
      required: ["monthly_contribution"], additionalProperties: false,
    },
    execute: simulate_goal_pace,
  },
  {
    name: "spending_timeseries_daily",
    description: "Série DIÁRIA BRUTA de gastos (ou receitas) com média móvel de 7 dias. Use APENAS quando o usuário quiser ver o valor GASTO EM CADA DIA. Para 'gasto médio dia a dia', 'estou reduzindo?', 'tendência', 'andando de lado' use spending_average_daily_trend (média acumulada).",
    parameters: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["expense", "income"] },
        from: optionalStr, to: optionalStr,
        days: { type: "integer", minimum: 1, maximum: 366 },
      },
      additionalProperties: false,
    },
    execute: spending_timeseries_daily,
  },
  {
    name: "spending_average_daily_trend",
    description: "Série da MÉDIA DIÁRIA ACUMULADA (consumo_acumulado / dias_corridos) e tendência (falling|rising|flat). Responde 'meu gasto médio dia a dia', 'estou reduzindo?', 'andando de lado?', 'como está a tendência do meu gasto'. Só consumo real (mesma definição da Home).",
    parameters: {
      type: "object",
      properties: { from: optionalStr, to: optionalStr },
      additionalProperties: false,
    },
    execute: spending_average_daily_trend,
  },
  {
    name: "generate_chart_artifact",
    description: "OBRIGATÓRIO em qualquer pedido visual/de tendência. Gera artefato de gráfico exibido no app e enviado como PNG no WhatsApp. Kinds: 'average_daily_trend' (gasto médio dia a dia / tendência / estou reduzindo), 'timeseries' (série diária bruta), 'compare' (dois períodos), 'forecast' (fechamento do mês), 'goal' (meta). Retorna artifact_id persistido.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["compare", "forecast", "goal", "timeseries", "average_daily_trend"] },
        goal_id: optionalStr, goal: optionalStr,
        metric: { type: "string", enum: ["expense", "income"] },
        period_a: periodSchema, period_b: periodSchema,
        from: optionalStr, to: optionalStr,
        days: { type: "integer", minimum: 1, maximum: 366 },
      },
      required: ["kind"], additionalProperties: false,
    },
    execute: generate_chart_artifact,
  },
  {
    name: "generate_report_from_template",
    description: "Gera um relatório visual a partir de um template ATIVO cadastrado (financial_report_templates). Use quando o usuário pedir um relatório nomeado: 'evolução dos gastos' (spending_trend), 'compara com o mês passado' (monthly_comparison), 'one page semanal' / 'resumo da semana' (weekly_one_page). Determinístico e sem custo de LLM.",
    parameters: {
      type: "object",
      properties: {
        template_key: { type: "string", enum: ["spending_trend", "monthly_comparison", "weekly_one_page"] },
        params: {
          type: "object",
          description: "Parâmetros do template. spending_trend: { from?, to? } em YYYY-MM-DD. monthly_comparison: { metric: 'expense' | 'income' }. weekly_one_page: { weeks_back: 0..52 }. Validação estrita via Zod no servidor.",
          additionalProperties: false,
          properties: {
            from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            metric: { type: "string", enum: ["expense", "income"] },
            weeks_back: { type: "integer", minimum: 0, maximum: 52 },
          },
        },
      },
      required: ["template_key"], additionalProperties: false,
    },
    execute: generate_report_from_template,
  },
  {
    name: "list_shared_goals",
    description: "Lista as metas conjuntas visíveis ao usuário (owner ou membro).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: list_shared_goals,
  },
  {
    name: "get_shared_goal_progress",
    description: "Retorna progresso agregado (total contribuído, restante, %) e ranking de contribuintes de uma meta conjunta.",
    parameters: { type: "object", properties: { goal: optionalStr, goal_id: optionalStr }, additionalProperties: false },
    execute: get_shared_goal_progress,
  },
  {
    name: "simulate_shared_goal_pace",
    description: "Simula a data de conclusão de uma meta conjunta considerando um aporte mensal hipotético.",
    parameters: {
      type: "object",
      properties: { goal: optionalStr, goal_id: optionalStr, monthly_contribution: num },
      required: ["monthly_contribution"], additionalProperties: false,
    },
    execute: simulate_shared_goal_pace,
  },
  {
    name: "create_shared_goal_draft",
    description: "Cria uma PROPOSTA de meta conjunta. Requer confirmação do usuário antes de persistir.",
    parameters: {
      type: "object",
      properties: { title: requiredStr, target_amount: num, deadline: optionalStr },
      required: ["title", "target_amount"], additionalProperties: false,
    },
    execute: create_shared_goal_draft,
  },
  {
    name: "add_shared_goal_contribution_draft",
    description: "Cria uma PROPOSTA de contribuição em uma meta conjunta existente. Requer confirmação.",
    parameters: {
      type: "object",
      properties: { goal: requiredStr, amount: num, occurred_at: optionalStr, note: optionalStr },
      required: ["goal", "amount"], additionalProperties: false,
    },
    execute: add_shared_goal_contribution_draft,
  },
  {
    name: "explain_shared_goal_ranking",
    description: "Explica o ranking de contribuintes de uma meta conjunta destacando os três primeiros.",
    parameters: { type: "object", properties: { goal: optionalStr, goal_id: optionalStr }, additionalProperties: false },
    execute: explain_shared_goal_ranking,
  },
];


export function toolByName(name: string): ToolSpec | null {
  return AGENT_TOOLS.find(t => t.name === name) ?? null;
}

/**
 * Exposes only the tools selected by the capability router for this turn.
 *
 * Sending the full registry to every model call made tool selection
 * probabilistic and allowed unrelated tools with similar descriptions to
 * compete. An omitted/empty allow-list intentionally means "all" to preserve
 * backwards compatibility for admin simulators and older callers.
 */
export function openAIToolDefinitions(allowedNames?: readonly string[]) {
  const allowed = allowedNames?.length ? new Set(allowedNames) : null;
  return AGENT_TOOLS.filter(t => !allowed || allowed.has(t.name)).map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
