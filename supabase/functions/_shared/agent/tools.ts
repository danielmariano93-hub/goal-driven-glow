// Agent tools — server-side implementations. Each `execute` receives its
// user_id from the caller context (never from the model). All ownership
// checks happen inside the SQL RPCs or explicit WHERE user_id filters.
//
// The set below is used both by the LLM path (as JSON-schema tools) and
// as first-class helpers from the deterministic fallback.

// deno-lint-ignore-file no-explicit-any
// Local alias to avoid resolving the Deno remote URL from tsgo/vitest.
type SupabaseClient = any;
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  isRealMonthlyMovement,
  type TransactionRow,
} from "../engine/facts.ts";

import { computeAgentSnapshot } from "../engine/metrics.ts";
import { computeGoalStrategy } from "./goalStrategyTool.ts";
import {
  computeEmotionFinance,
  DEFAULT_MIN_COMPOSITE_SAMPLE,
  DEFAULT_MIN_DELTA_ABS,
  DEFAULT_MIN_SAMPLE,
  DEFAULT_MIN_UPLIFT_PCT,
} from "../finance-core/emotionFinance.ts";

import { cycleFor } from "../finance-core/cardExposure.ts";
import { executeWeekdayPattern } from "../intelligence/weekdayTool.ts";
import { interpretSemanticQuery } from "../intelligence/semanticQuery.ts";
import { computeBehavioralSignals } from "../insights/facts.ts";
import { resolveEntity, type Candidate } from "./resolvers.ts";
import { resolveOccurredAt, todaySaoPaulo } from "./parser.ts";
import { parseSpelledMoney } from "./amountWords.ts";
import { renderDraftCard, renderReceiptCard, renderUpdateCard, draftCardBRL, draftCardDateBR } from "./core/DraftCard.ts";
import { confirmAndBuildReceipt } from "./core/ConfirmAndReceipt.ts";
import { resolveBehavioralDate } from "../analytics/behavioralDate.ts";
import { makeProvenance } from "../analytics/provenance.ts";
import {
  emotionByKey, emotionOptionsSentence, moodToEmotion, parseEmotionFromText, resolveEmotionTerm,
} from "../intelligence/emotionParse.ts";

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
      select: "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,refund_of_transaction_id",
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
  // finance_truth.v1: estorno abate a categoria economica original da compra.
  const refundAttribution = buildRefundAttribution(rows as any);
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
    const effectiveCategory = effectiveCategoryId(row as any, refundAttribution);
    const category = String(effectiveCategory ? (names.get(effectiveCategory) ?? "Sem categoria") : "Sem categoria");
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
      select: "id,account_id,category_id,type,status,amount,occurred_at,behavioral_day,behavior_date_source,behavior_date_confidence,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,refund_of_transaction_id",
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
  const dateRefundAttribution = buildRefundAttribution((data ?? []) as any);
  for (const raw of (data ?? []) as any[]) {
    const resolved = resolveBehavioralDate(raw);
    if (resolved.day !== date) continue;
    if (!resolved.eligibleForBehavior) {
      excludedLowConfidence++;
      continue;
    }
    const amount = behavioralMetricAmount({ ...raw, amount: Number(raw.amount) } as any, "expense");
    if (amount <= 0) continue;
    const rawEffectiveCategory = effectiveCategoryId(raw as any, dateRefundAttribution);
    const category = String(rawEffectiveCategory ? (names.get(rawEffectiveCategory) ?? "Sem categoria") : "Sem categoria");
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

/** Lista as contas ativas do usuário (nome + id). */
export async function listActiveAccounts(ctx: ToolContext): Promise<Array<{ id: string; name: string; type?: string }>> {
  const { data, error } = await ctx.sb.from("accounts").select("id,name,type")
    .eq("user_id", ctx.user_id).eq("active", true).order("name");
  if (error) throw new Error(`accounts_query_failed:${error.message}`);
  return (data ?? []) as Array<{ id: string; name: string; type?: string }>;
}

/** Resolve a conta do lançamento.
 *  Hint ausente/vazio NÃO é erro: quando o usuário tem exatamente uma conta
 *  ativa, ela é a conta padrão e o lançamento segue sem pergunta. Só devolve
 *  null quando há ambiguidade real (2+ contas) ou o hint não casa com nada. */
async function resolveAccountId(ctx: ToolContext, hintOrId?: string): Promise<{ id: string; name: string } | null> {
  const accounts = await listActiveAccounts(ctx);
  const hint = String(hintOrId ?? "").trim();
  if (!hint) {
    return accounts.length === 1 ? { id: accounts[0].id, name: accounts[0].name } : null;
  }
  const list: Candidate[] = accounts.map((a: any) => ({
    id: a.id, name: a.name, aliases: [a.type].filter(Boolean),
  }));
  const r = resolveEntity(hint, list);
  if (r.kind === "single") return { id: r.match.id, name: r.match.name };
  // Hint genérico ("conta corrente", "conta") com uma única conta ativa:
  // é a conta padrão do usuário.
  if (accounts.length === 1 && /\bconta\b|\bcorrente\b|\bd[eé]bito\b|\bdinheiro\b/i.test(hint)) {
    return { id: accounts[0].id, name: accounts[0].name };
  }
  return null;
}


async function categoryNameById(ctx: ToolContext, id: string): Promise<string | null> {
  const { data } = await ctx.sb.from("categories").select("name").eq("id", id).maybeSingle();
  return (data as any)?.name ?? null;
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

/** Palavras que nunca são estabelecimento/descrição. */
const NON_MERCHANT_TERMS = new Set([
  ...METHOD_ONLY_TERMS,
  "gasto","gastos","despesa","despesas","receita","receitas","reais","real","conta","contas",
  "hoje","ontem","anteontem","amanha","categoria","descricao","valor","banco","dinheiro",
  "mes","mês","semana","dia","dias","total","parcelas","parcela","vezes",
]);

/**
 * Extrai o "em quê foi" de frases como "gasto em 15/08 em adega" ou
 * "paguei 40 no posto". Serve de DESCRIÇÃO — nunca de categoria.
 */
export function extractMerchantFromText(text?: string | null): string | null {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;
  const rx = /\b(?:em|no|na|nos|nas|num|numa)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'’\-\s]{1,30})/gi;
  const found: string[] = [];
  for (const m of raw.matchAll(rx)) {
    const candidate = String(m[1] ?? "")
      .replace(/\s+(?:em|no|na|de|do|da|com|por)\b.*$/i, "")
      .trim()
      .replace(/[.,;!?]+$/, "");
    if (!candidate) continue;
    const norm = normalizeDesc(candidate);
    if (!norm || /\d/.test(norm)) continue;
    if (norm.split(/\s+/).every((w) => NON_MERCHANT_TERMS.has(w))) continue;
    found.push(candidate);
  }
  // O último "em X" da frase costuma ser o estabelecimento ("gasto em 15/08 em adega").
  return found.length ? found[found.length - 1] : null;
}


/**
 * Tipo do lançamento é INFERIDO, não recusado. O modelo às vezes omite `type`
 * e o usuário nunca deve receber erro técnico por isso: verbos de entrada
 * ("recebi", "salário", "caiu") indicam receita, o resto é despesa.
 */
export function inferDraftType(
  provided: unknown,
  userText?: string | null,
): "income" | "expense" | null {
  if (provided === "income" || provided === "expense") return provided;
  const t = String(userText ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (!t.trim()) return "expense";
  if (/\b(recebi|receb\w*|ganhei|entrou|caiu|salario|pro labore|pro-labore|reembolso|rendimento|comissao|freela|deposito recebido|pix recebido|venda)\b/.test(t)) {
    return "income";
  }
  if (/\b(gastei|paguei|comprei|torrei|debitou|debitei|assinatura|conta|boleto|almoc\w*|jantar|mercado|uber|lancamento|registr\w*|anot\w*)\b/.test(t)) {
    return "expense";
  }
  // Sem sinal nenhum: despesa é o caso dominante em lançamento manual.
  return "expense";
}

export async function create_transaction_draft(ctx: ToolContext, args: {
  type?: "income"|"expense"; amount: number; account?: string;
  credit_card?: string; installments_total?: number;
  category?: string; occurred_at?: string; description?: string;
}): Promise<ToolResult> {
  const inferredType = inferDraftType(args?.type, ctx.user_text);
  if (!inferredType) {
    return {
      ok: false,
      error: "needs_type",
      hint: "Não ficou claro se é gasto ou recebimento. Pergunte isso em UMA frase curta e não crie o rascunho antes da resposta.",
    } as any;
  }
  args = { ...args, type: inferredType };
  const spelled = parseSpelledMoney(String(ctx.user_text ?? ""));
  const amount = Number(Number.isFinite(Number(args?.amount)) && Number(args?.amount) > 0 ? args.amount : (spelled ?? args?.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      error: "needs_amount",
      hint: "Não identifiquei o valor. Pergunte o valor em UMA frase curta, preservando o que já foi entendido (estabelecimento/data), e não crie o rascunho antes da resposta.",
    } as any;
  }
  let rawDesc = (args.description ?? "").trim();
  const normDesc = normalizeDesc(rawDesc);
  if (rawDesc && METHOD_ONLY_TERMS.has(normDesc)) {
    return { ok: false, error: "needs_description", hint: "A descrição não pode ser apenas o meio de pagamento (crédito, débito, pix, cartão…). Pergunte ao usuário 'em quê foi essa compra?' antes de criar o rascunho." } as any;
  }
  const occurred_at = resolveOccurredAt({ text: ctx.user_text, modelValue: args.occurred_at ?? null }).iso;
  // Category Truth V2: only a category literally requested by the user may enter the draft as user truth.
  // Any model-inferred category stays null and is resolved by the central queue after confirmation.
  const explicitCategoryHint = isExplicitCategoryMention(ctx.user_text, args.category) ? args.category : undefined;
  const cat = await resolveCategoryId(ctx, explicitCategoryHint, args.type);
  const categoryName = cat ? await categoryNameById(ctx, cat) : null;

  // "gastei 96 em adega" — "adega" é DESCRIÇÃO/estabelecimento, não categoria.
  // Se o modelo mandou isso como categoria (e não foi pedido explicitamente),
  // aproveitamos como descrição em vez de descartar a informação do usuário.
  if (!rawDesc) {
    const fromCategoryArg = !explicitCategoryHint && args.category ? String(args.category).trim() : "";
    const merchant = extractMerchantFromText(ctx.user_text);
    rawDesc = (merchant || fromCategoryArg || "").trim();
  }
  if (!rawDesc) {
    return {
      ok: false,
      error: "needs_description",
      hint: "Não há descrição nem estabelecimento. Pergunte em UMA frase curta em quê foi o gasto (ex.: 'R$ 96,00 em 15/08 — em quê foi?') e não crie o rascunho antes da resposta.",
    } as any;
  }
  const description = rawDesc;
  const categoryStatus: "explicit" | "auto_later" = cat && explicitCategoryHint ? "explicit" : "auto_later";

  if (args.credit_card && args.type === "expense") {
    const card = await resolveCreditCardId(ctx, args.credit_card);
    if (!card) return { ok: false, error: "card_not_found" };
    const n = Math.max(1, Math.min(48, Number(args.installments_total ?? 1) || 1));
    const payload = {
      type: args.type, amount, occurred_at,
      description,
      category_id: cat,
      category_explicit: Boolean(cat && explicitCategoryHint),
      payment_method: "credit_card",
      credit_card_id: card.id,
      installments_total: n,
    };
    const parcelStr = n > 1 ? ` em ${n}x` : "";
    const summary = `Despesa de ${BRL.format(amount)} no cartão ${card.name}${parcelStr} — ${description} em ${occurred_at}.`;
    const id = await upsertDraft(ctx, "transaction", payload, summary);
    if (!id) return { ok: false, error: "draft_failed" };
    const fields = {
      kind: "expense" as const,
      amount, description, category: categoryName, category_status: categoryStatus,
      card: card.name, installments_total: n, occurred_at,
    };
    return {
      ok: true,
      result: {
        draft_id: id, summary, card: card.name, installments_total: n,
        card_fields: fields, card_text: renderDraftCard(fields, id),
      },
    };
  }

  const acc = await resolveAccountId(ctx, args.account);
  if (!acc) {
    const options = (await listActiveAccounts(ctx)).map((a) => a.name).filter(Boolean);
    return {
      ok: false,
      error: "account_not_found",
      result: { accounts: options },
      hint: options.length
        ? `Pergunte em UMA frase curta em qual conta registrar, listando: ${options.join(", ")}.`
        : "O usuário não tem conta ativa cadastrada. Peça para cadastrar uma conta no app.",
    } as any;
  }

  const payload = { type: args.type, amount, account_id: acc.id, category_id: cat, category_explicit: Boolean(cat && explicitCategoryHint), occurred_at, description, payment_method: "account" };
  const summary = `${args.type === "income" ? "Receita" : "Despesa"} de ${BRL.format(amount)} em ${acc.name} — ${description} em ${occurred_at}.`;
  const id = await upsertDraft(ctx, "transaction", payload, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  const fields = {
    kind: args.type === "income" ? "income" as const : "expense" as const,
    amount, description, category: categoryName, category_status: categoryStatus,
    account: acc.name, occurred_at,
  };
  return {
    ok: true,
    result: { draft_id: id, summary, card_fields: fields, card_text: renderDraftCard(fields, id) },
  };
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
    .select("id, kind, expires_at, payload")
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
  const outcome = await confirmAndBuildReceipt(ctx.sb, {
    id: (pending as any).id, kind: (pending as any).kind, user_id: ctx.user_id,
    payload: (pending as any).payload,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error ?? "confirmation_failed" };
  const execution = outcome.execution!;
  const result = { ok: true, result: execution.result, idempotent: execution.idempotent };

  // Recibo canônico (buildActionReceipt): valor, categoria, conta/cartão,
  // competência e como corrigir — nunca uma frase genérica.
  let receipt = outcome.reply;
  if (!result.idempotent && (pending as any).kind === "transaction") {
    const payload = ((pending as any).payload ?? {}) as any;
    const catName = payload.category_id ? await categoryNameById(ctx, String(payload.category_id)) : null;
    receipt = renderReceiptCard({
      kind: payload.type === "income" ? "income" : "expense",
      amount: Number(payload.amount ?? result.result?.amount ?? 0),
      description: payload.description ?? null,
      category: catName,
      occurred_at: String(payload.occurred_at ?? todaySaoPaulo()),
    }, String((pending as any).id));
  }

  // Auto-aprendizado: correção de categoria feita pelo usuário passa a valer
  // para o mesmo estabelecimento nas próximas vezes.
  if (!result.idempotent && (pending as any).kind === "transaction_update") {
    const payload = ((pending as any).payload ?? {}) as any;
    const newCategoryId = payload?.patch?.category_id ?? null;
    if (newCategoryId && payload?.transaction_id) {
      try {
        await ctx.sb.rpc("agent_learn_merchant_category", {
          p_user_id: ctx.user_id,
          p_transaction_id: payload.transaction_id,
          p_category_id: newCategoryId,
        });
      } catch (_e) { /* aprendizado nunca quebra a confirmação */ }
    }
  }

  return {
    ok: true,
    result: {
      draft_id: (pending as any).id,
      kind: (pending as any).kind,
      idempotent: !!result.idempotent,
      receipt,
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

  // Cartão humano da edição: nomes reais no lugar de ids técnicos.
  const newCategoryName = patch.category_id
    ? await categoryNameById(ctx, String(patch.category_id))
    : ("category_id" in patch ? "eu classifico depois" : null);
  const oldCategoryName = (tx as any).category_id
    ? await categoryNameById(ctx, String((tx as any).category_id))
    : null;
  const changes = Object.keys(patch).map((field) => {
    if (field === "category_id") return { field, from: oldCategoryName, to: newCategoryName };
    if (field === "amount") {
      return { field, from: draftCardBRL.format(Number((tx as any).amount ?? 0)), to: draftCardBRL.format(Number(patch.amount)) };
    }
    if (field === "occurred_at") {
      return { field, from: draftCardDateBR(String((tx as any).occurred_at)), to: draftCardDateBR(String(patch.occurred_at)) };
    }
    if (field === "description") return { field, from: (tx as any).description ?? null, to: String(patch.description ?? "—") };
    if (field === "payment_method") return { field, from: null, to: patch.payment_method === "credit_card" ? "cartão de crédito" : "conta" };
    if (field === "account_id" || field === "credit_card_id") return null;
    return { field, from: null, to: String(patch[field] ?? "—") };
  }).filter(Boolean) as Array<{ field: string; from?: string | null; to?: string | null }>;

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
  return {
    ok: true,
    result: {
      draft_id: draftId, summary, transaction_id: id, scope, patch,
      before: (payload as any).before,
      card_text: renderUpdateCard(changes, scope, draftId),
    },
  };
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
      select: "id,type,amount,category_id,occurred_at,status,transfer_group_id,description,account_id,payment_method,credit_card_id,settles_card_id,movement_kind,refund_of_transaction_id",
      from: `${ym}-01`,
      status: "confirmed",
    }),
    fetchTransactions(ctx, {
      select: "id,type,amount,category_id,occurred_at,status,transfer_group_id,description,account_id,payment_method,credit_card_id,settles_card_id,movement_kind,refund_of_transaction_id",
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
    // Trava anti-troca-de-métrica: quem decide a interpretação é o texto do
    // usuário, não o modelo. Sem isso, uma pergunta de média virava
    // "concentração do total" no turno seguinte, sem o usuário pedir.
    const semantic = interpretSemanticQuery(ctx.user_text ?? "");
    const interpretation = semantic?.interpretation && semantic.interpretation !== "raw_series"
      ? semantic.interpretation
      : (args?.interpretation ?? "typical_behavior");
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
        period: { kind: "rolling_weeks", value: Math.max(4, Math.min(52, Number(semantic?.period.value ?? args?.weeks ?? 12))) },
        correction: Boolean(semantic?.correction),
        challenge: Boolean(semantic?.challenge),
        mentioned_weekdays: semantic?.mentioned_weekdays ?? [],
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

/**
 * Plano de ataque da meta: quanto por mês, quanto por semana, de onde tirar
 * e qual é o próximo passo. Tudo calculado, nada estimado pelo modelo.
 */
export async function get_goal_strategy(
  ctx: ToolContext,
  args: { goal?: string; goal_id?: string } = {},
): Promise<ToolResult> {
  try {
    const result = await computeGoalStrategy(ctx.sb, ctx.user_id, args);
    if (result.plans.length === 0) {
      return { ok: true, result: { ...result, message: "Nenhuma meta ativa encontrada para montar o plano." } };
    }
    return { ok: true, result };
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
import { computeForecast } from "../analytics/forecast.ts";
import {
  analyze_merchants, merchant_distribution, merchant_profile, explain_behavior_change, discover_recurring,
  analyze_cost_structure, detect_spending_anomalies, find_savings_opportunities,
  analyze_financial_evolution, get_debt_status,
  compare_financial_metric, assess_financial_performance,
  analyze_longitudinal_trajectory, analyze_wealth_opportunity, build_financial_plan,
} from "./engineTools.ts";
import { planInstallmentDecision } from "./core/AdvisorConsult.ts";

export {
  analyze_merchants, merchant_distribution, merchant_profile, explain_behavior_change, discover_recurring,
  analyze_cost_structure, detect_spending_anomalies, find_savings_opportunities,
  analyze_financial_evolution, get_debt_status,
  compare_financial_metric, assess_financial_performance,
  analyze_longitudinal_trajectory, analyze_wealth_opportunity, build_financial_plan,
};

/**
 * Consultoria de decisão parcelada (`nino_advisor.v1`).
 *
 * Responde "consigo assumir essa parcela?" com linha do tempo mês a mês, e —
 * quando não cabe ou cabe apertado — já traz onde liberar o valor que falta,
 * usando o motor de oportunidades reais de economia. Nenhum número é estimado
 * pelo modelo: tudo vem do snapshot canônico e dos motores determinísticos.
 */
export async function plan_installment_decision(ctx: ToolContext, args: {
  amount: number;
  installments?: number;
  method?: "cash" | "card";
  description?: string;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const installments = Math.max(1, Math.min(48, Math.floor(Number(args?.installments ?? 1)) || 1));
  const method: "cash" | "card" = args?.method === "cash" ? "cash" : "card";

  const snap = await computeAgentSnapshot(ctx.sb, ctx.user_id);
  const settingsRes = await ctx.sb.from("user_financial_settings")
    .select("approximate_monthly_income").eq("user_id", ctx.user_id).maybeSingle();
  const declaredIncome = Number(settingsRes?.data?.approximate_monthly_income ?? 0);
  const observedIncome = Number(snap.current_month_income ?? 0)
    + Number(snap.confirmed_future_income ?? 0)
    + Number(snap.estimated_fixed_income ?? 0);
  const monthlyIncome = declaredIncome > 0 ? declaredIncome : observedIncome;

  const monthlyTypicalExpense = Math.round(Number(snap.typical_daily_pace ?? 0) * 30 * 100) / 100;
  const monthlyDebtInstallments = (snap.active_debts ?? [])
    .reduce((sum: number, d: any) => sum + Number(d.installment_amount ?? 0), 0);

  // Parcelas de cartão já contratadas, por mês de competência futuro.
  const cardByMonth: Record<string, number> = {};
  const instRes = await ctx.sb.from("credit_card_installments")
    .select("competence_month,amount,status")
    .eq("user_id", ctx.user_id)
    .gte("competence_month", snap.today.slice(0, 7));
  for (const row of (instRes?.data ?? []) as any[]) {
    if (String(row.status ?? "") === "paid") continue;
    const key = String(row.competence_month ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    cardByMonth[key] = Math.round(((cardByMonth[key] ?? 0) + Number(row.amount ?? 0)) * 100) / 100;
  }
  const futureMonths = Object.values(cardByMonth);
  const monthlyCardInstallments = futureMonths.length
    ? Math.round(futureMonths.reduce((a, b) => a + b, 0) / futureMonths.length * 100) / 100
    : 0;

  const decision = planInstallmentDecision({
    amount, installments, method,
    today: snap.today,
    projected_month_end_available: Number(snap.projected_month_end_available ?? 0),
    monthly_income: monthlyIncome,
    monthly_typical_expense: monthlyTypicalExpense,
    monthly_debt_installments: monthlyDebtInstallments,
    monthly_card_installments: monthlyCardInstallments,
    card_installments_by_month: cardByMonth,
  });

  // Consultor de verdade: quando aperta, já mostra de onde tirar.
  let savings: unknown = null;
  if (decision.verdict !== "cabe") {
    const opportunities = await find_savings_opportunities({ sb: ctx.sb, user_id: ctx.user_id }, { days: 90 })
      .catch(() => null);
    savings = opportunities && (opportunities as any).ok ? (opportunities as any).result : null;
  }

  return {
    ok: true,
    result: {
      ...decision,
      description: args?.description ?? null,
      reconciliation_id: snap.reconciliation_id,
      income_basis: declaredIncome > 0 ? "declared_monthly_income" : "observed_income_projection",
      monthly_income: monthlyIncome,
      monthly_typical_expense: monthlyTypicalExpense,
      monthly_debt_installments: Math.round(monthlyDebtInstallments * 100) / 100,
      monthly_card_installments: monthlyCardInstallments,
      savings_plan: savings,
      answer_format: {
        shape: "advisor_decision",
        must_include: [
          "veredito direto (cabe / cabe apertado / não cabe)",
          "valor da parcela e nº de meses",
          "folga mensal projetada e meses apertados, se houver",
          decision.verdict === "cabe"
            ? "uma recomendação de acompanhamento"
            : "quanto precisa liberar por mês e de onde (savings_plan)",
          "uma pergunta de decisão no final",
        ],
        forbidden: ["inventar juros", "calcular número fora deste resultado", "listar genérico sem valor em reais"],
      },
    },
  };
}

async function loadTxAndCategories(ctx: ToolContext, from: string, to: string) {
  const [txs, categoriesResult] = await Promise.all([
    fetchTransactions(ctx, {
      select: "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,refund_of_transaction_id",
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

/** Histórico de 400 dias + recorrências, base da banda/backtest do forecast. */
async function loadForecastHistory(ctx: ToolContext) {
  const today = todaySP();
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 400);
  const from = start.toISOString().slice(0, 10);
  const monthEnd = monthRange(today).to;
  const [txs, recurringResult] = await Promise.all([
    fetchTransactions(ctx, {
      select: "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,refund_of_transaction_id",
      from,
      to: monthEnd,
    }),
    ctx.sb.from("recurring_entries")
      .select("id,name,type,amount,frequency,next_due_date,active")
      .eq("user_id", ctx.user_id),
  ]);
  return {
    txs: (txs ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })),
    recurring: (recurringResult.data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })),
  };
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
  // Banda de incerteza, backtest e sazonalidade vêm do estimador estatístico
  // (`analytics/forecast`), que roda sobre o histórico real. O PONTO CENTRAL
  // continua sendo o do snapshot canônico — Home, App e WhatsApp idênticos.
  let statistical: ReturnType<typeof computeForecast> | null = null;
  const statisticalNotes: string[] = [];
  try {
    const history = await loadForecastHistory(ctx);
    statistical = computeForecast({
      txs: history.txs as any,
      recurring: history.recurring as any,
      today: todaySP(),
      model: args?.model ?? "auto",
    });
  } catch (_e) {
    statisticalNotes.push("Não foi possível calcular a banda estatística nesta consulta.");
  }
  // Desloca a banda do estimador para o ponto canônico, preservando a largura.
  const spread = statistical && statistical.low != null && statistical.high != null
    ? { low: statistical.point - statistical.low, high: statistical.high - statistical.point }
    : null;
  const low = spread ? Math.round(Math.max(0, point - spread.low) * 100) / 100 : null;
  const high = spread ? Math.round((point + spread.high) * 100) / 100 : null;
  const backtest = statistical?.backtest_summary ?? null;
  const seasonalAdjust = statistical?.drivers.seasonal_adjust ?? 0;
  if (statistical && spread === null) {
    statisticalNotes.push("Sem histórico diário suficiente (mínimo 30 dias com movimento) para faixa de incerteza.");
  }
  if (statistical && !backtest) {
    statisticalNotes.push("Sem meses fechados suficientes (mínimo 2) para backtest da previsão.");
  }
  return { ok: true, result: {
    month: snapshot.month_start.slice(0, 7),
    point,
    low,
    high,
    model_used: statistical
      ? `financial_snapshot_contract.v8+${statistical.model_used}`
      : "financial_snapshot_contract.v8",
    drivers: {
      mtd_expense: snapshot.current_month_expense,
      day_of_month: snapshot.days_elapsed,
      days_in_month: daysInMonth,
      recurring_future: committedFuture,
      seasonal_adjust: seasonalAdjust,
    },
    backtest_summary: backtest,
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
        ...statisticalNotes,
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

// ---------- Patrimônio, investimentos, parcelas futuras, recorrências e agenda ----------
// Leituras canônicas: todo número vem do snapshot financeiro único ou da tabela
// dona do dado. Nenhuma dessas tools recalcula verdade por conta própria.

export async function get_net_worth(ctx: ToolContext): Promise<ToolResult> {
  try {
    const snap = await computeAgentSnapshot(ctx.sb, ctx.user_id);
    const c = snap.net_worth_composition;
    return {
      ok: true,
      result: {
        net_worth: snap.net_worth,
        composition: c,
        explanation: `Patrimônio = dinheiro em conta (${BRL.format(c.cash)}) + investido (${BRL.format(c.invested)}) − cheque especial (${BRL.format(c.account_overdraft)}) − fatura de cartão em aberto (${BRL.format(c.cards_owed)}) − outras dívidas (${BRL.format(c.other_debts)}).`,
        bridge: snap.net_worth_bridge,
        provenance: makeProvenance({
          from: snap.month_start, to: snap.today,
          row_count: snap.source_transaction_count,
          formula_version: snap.formula_version,
          confidence: "high",
        }),
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function list_investments(ctx: ToolContext): Promise<ToolResult> {
  const { data, error } = await ctx.sb.from("investments")
    .select("id,name,category,institution,invested_amount,current_value,reference_date,goal_id")
    .eq("user_id", ctx.user_id).order("current_value", { ascending: false });
  if (error) return { ok: false, error: `investments_query_failed:${error.message}` };
  const rows = (data ?? []) as any[];
  const invested = rows.reduce((a, r) => a + Number(r.invested_amount || 0), 0);
  const current = rows.reduce((a, r) => a + Number(r.current_value || 0), 0);
  const byCategory: Record<string, number> = {};
  for (const r of rows) {
    const key = String(r.category ?? "outros");
    byCategory[key] = Math.round(((byCategory[key] ?? 0) + Number(r.current_value || 0)) * 100) / 100;
  }
  return {
    ok: true,
    result: {
      items: rows.map((r) => ({
        id: r.id, name: r.name, category: r.category, institution: r.institution,
        invested_amount: Number(r.invested_amount || 0),
        current_value: Number(r.current_value || 0),
        result: Math.round((Number(r.current_value || 0) - Number(r.invested_amount || 0)) * 100) / 100,
        reference_date: r.reference_date, goal_id: r.goal_id,
      })),
      count: rows.length,
      total_invested: Math.round(invested * 100) / 100,
      total_current_value: Math.round(current * 100) / 100,
      total_result: Math.round((current - invested) * 100) / 100,
      by_category: byCategory,
    },
  };
}

export async function get_future_installments(ctx: ToolContext, args?: { months?: number }): Promise<ToolResult> {
  const months = Math.max(1, Math.min(24, Number(args?.months ?? 6)));
  const today = todaySaoPaulo();
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const fromMonth = `${today.slice(0, 7)}-01`;
  const endDate = new Date(Date.UTC(y, (m - 1) + months, 1));
  const toMonthExclusive = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const [instRes, cardsRes] = await Promise.all([
    ctx.sb.from("credit_card_installments")
      .select("id,credit_card_id,installment_number,amount,competence_month,due_date,status,purchase_id")
      .eq("user_id", ctx.user_id)
      .gte("competence_month", fromMonth).lt("competence_month", toMonthExclusive)
      .order("competence_month"),
    ctx.sb.from("credit_cards").select("id,name").eq("user_id", ctx.user_id),
  ]);
  if (instRes.error) return { ok: false, error: `installments_query_failed:${instRes.error.message}` };
  if (cardsRes.error) return { ok: false, error: `cards_query_failed:${cardsRes.error.message}` };
  const cardName = new Map(((cardsRes.data ?? []) as any[]).map((c) => [c.id, c.name]));
  const rows = ((instRes.data ?? []) as any[]).filter((r) => String(r.status ?? "").toLowerCase() !== "cancelled");
  const byMonth = new Map<string, { competence_month: string; total: number; count: number }>();
  for (const r of rows) {
    const key = String(r.competence_month).slice(0, 7);
    const bucket = byMonth.get(key) ?? { competence_month: key, total: 0, count: 0 };
    bucket.total = Math.round((bucket.total + Number(r.amount || 0)) * 100) / 100;
    bucket.count += 1;
    byMonth.set(key, bucket);
  }
  return {
    ok: true,
    result: {
      horizon_months: months,
      total: Math.round(rows.reduce((a, r) => a + Number(r.amount || 0), 0) * 100) / 100,
      by_month: [...byMonth.values()].sort((a, b) => a.competence_month.localeCompare(b.competence_month)),
      items: rows.slice(0, 60).map((r) => ({
        card: cardName.get(r.credit_card_id) ?? "Cartão",
        installment_number: r.installment_number,
        amount: Number(r.amount || 0),
        competence_month: String(r.competence_month).slice(0, 7),
        due_date: r.due_date,
        status: r.status,
      })),
      count: rows.length,
      note: "Competência é o mês em que a parcela entra na fatura; o vencimento é a data de pagamento.",
    },
  };
}

export async function list_recurring_rules(ctx: ToolContext): Promise<ToolResult> {
  const [rulesRes, catsRes, accountsRes] = await Promise.all([
    ctx.sb.from("recurring_rules")
      .select("id,name,kind,amount,frequency,day_of_month,weekday,start_date,end_date,status,account_id,category_id")
      .eq("user_id", ctx.user_id).order("amount", { ascending: false }),
    ctx.sb.from("categories").select("id,name").or(`user_id.eq.${ctx.user_id},user_id.is.null`),
    ctx.sb.from("accounts").select("id,name").eq("user_id", ctx.user_id),
  ]);
  if (rulesRes.error) return { ok: false, error: `recurring_query_failed:${rulesRes.error.message}` };
  const catName = new Map(((catsRes.data ?? []) as any[]).map((c) => [c.id, c.name]));
  const accName = new Map(((accountsRes.data ?? []) as any[]).map((a) => [a.id, a.name]));
  const rows = (rulesRes.data ?? []) as any[];
  const active = rows.filter((r) => String(r.status) === "active");
  const sum = (kind: string) =>
    Math.round(active.filter((r) => String(r.kind) === kind).reduce((a, r) => a + Number(r.amount || 0), 0) * 100) / 100;
  return {
    ok: true,
    result: {
      items: active.map((r) => ({
        id: r.id, name: r.name, kind: r.kind, amount: Number(r.amount || 0),
        frequency: r.frequency, day_of_month: r.day_of_month, weekday: r.weekday,
        start_date: r.start_date, end_date: r.end_date,
        category: r.category_id ? catName.get(r.category_id) ?? null : null,
        account: r.account_id ? accName.get(r.account_id) ?? null : null,
      })),
      active_count: active.length,
      paused_count: rows.length - active.length,
      monthly_expense_total: sum("expense"),
      monthly_income_total: sum("income"),
    },
  };
}

export async function get_commitments_agenda(ctx: ToolContext): Promise<ToolResult> {
  try {
    const snap = await computeAgentSnapshot(ctx.sb, ctx.user_id);
    const agenda = snap.commitment_agenda;
    return {
      ok: true,
      result: {
        ...agenda,
        net_expected: Math.round((agenda.total_income - agenda.total_expense) * 100) / 100,
        available_today: snap.available_today,
        provenance: makeProvenance({
          from: agenda.horizon_start, to: agenda.horizon_end,
          row_count: agenda.items.length,
          formula_version: snap.formula_version,
          confidence: agenda.has_estimates ? "medium" : "high",
          notes: agenda.has_estimates ? ["Alguns compromissos são estimativas de recorrência."] : undefined,
        }),
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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


/** Registro emocional por conversa: o Nino grava o catálogo canônico, nunca texto livre. */
async function log_emotional_checkin(ctx: ToolContext, args: {
  emotion?: string; mood?: number; notes?: string;
}): Promise<ToolResult> {
  const option = resolveEmotionTerm(args?.emotion)
    ?? emotionByKey(args?.emotion)
    ?? moodToEmotion(args?.mood)
    ?? parseEmotionFromText(args?.emotion)
    ?? parseEmotionFromText(ctx.user_text);
  if (!option) {
    return {
      ok: false,
      error: "emotion_not_recognized",
      details: { options: emotionOptionsSentence() },
      result: { ask: `Como você se sentiu? Pode ser: ${emotionOptionsSentence()}.` },
    };
  }

  const today = todaySaoPaulo();
  const dayStart = `${today}T00:00:00-03:00`;
  const dayEnd = `${today}T23:59:59-03:00`;
  // A fala original vira observação: preserva o que a pessoa contou sem
  // inventar sentimento que ela não disse.
  const rawText = String(ctx.user_text ?? "").trim().slice(0, 500);
  const notes = String(args?.notes ?? "").trim().slice(0, 500)
    || (rawText.split(/\s+/).length > 2 ? rawText : null);


  const { data: existing } = await ctx.sb.from("emotional_checkins")
    .select("id").eq("user_id", ctx.user_id)
    .gte("occurred_at", dayStart).lte("occurred_at", dayEnd)
    .order("occurred_at", { ascending: false }).limit(1).maybeSingle();

  const payload = {
    user_id: ctx.user_id,
    mood: option.mood,
    emotion_key: option.key,
    trigger_label: option.label,
    notes,
  };

  if (existing?.id) {
    const { error } = await ctx.sb.from("emotional_checkins")
      .update(payload).eq("id", existing.id).eq("user_id", ctx.user_id);
    if (error) return { ok: false, error: "emotional_checkin_update_failed", details: error.message };
  } else {
    const { error } = await ctx.sb.from("emotional_checkins")
      .insert({ ...payload, occurred_at: new Date().toISOString() });
    if (error) return { ok: false, error: "emotional_checkin_insert_failed", details: error.message };
  }

  // Sinal prospectivo: só sai quando o histórico da própria pessoa sustenta a
  // associação (amostra + consistência + materialidade). Nunca afirma causa.
  const signal = await emotionProspectiveSignal(ctx, option.key);

  return {
    ok: true,
    result: {
      registered: true,
      updated: Boolean(existing?.id),
      emotion_key: option.key,
      emotion_label: option.label,
      emoji: option.emoji,
      mood: option.mood,
      local_date: today,
      card: `${option.emoji} Registrei: hoje você se sentiu ${option.label.toLowerCase()}.`,
      prospective_signal: signal,
    },
  };
}

/** Aviso preventivo do dia, se o padrão pessoal existir e estiver habilitado. */
async function emotionProspectiveSignal(ctx: ToolContext, emotionKey: string) {
  try {
    const cfg = await loadEmotionFinanceSettings(ctx);
    if (!cfg.prospective_enabled) return null;
    const channel = String((ctx as unknown as { channel?: string }).channel ?? "app");
    const allowed = cfg.prospective_channels.length === 0
      || cfg.prospective_channels.includes(channel)
      || (channel !== "whatsapp" && cfg.prospective_channels.includes("app"));
    if (!allowed) return null;

    const patterns = await get_emotion_finance_patterns(ctx, { emotion: emotionKey });
    if (!patterns.ok) return null;
    const found = ((patterns.result as { patterns?: any[] })?.patterns ?? [])
      .find((p) => p.emotion_key === emotionKey && p.material && p.direction === "acima"
        && (p.confidence === "medium" || p.confidence === "high"));
    if (!found) return null;
    return {
      headline: found.sentence as string,
      question: "Quer que eu te ajude a segurar os gastos flexíveis hoje?",
      consistency: found.consistency as string,
    };
  } catch {
    return null;
  }
}


/** Últimos registros emocionais, para o Nino falar do padrão sem inventar. */
async function get_emotional_checkins(ctx: ToolContext, args: { days?: number }): Promise<ToolResult> {
  const days = Math.min(90, Math.max(1, Number(args?.days ?? 14)));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await ctx.sb.from("emotional_checkins")
    .select("occurred_at,mood,emotion_key,trigger_label,notes")
    .eq("user_id", ctx.user_id).gte("occurred_at", from)
    .order("occurred_at", { ascending: false }).limit(120);
  if (error) return { ok: false, error: "emotional_checkins_failed", details: error.message };
  const rows = (data ?? []) as Array<{ mood: number; emotion_key: string | null }>;
  const average = rows.length
    ? Math.round((rows.reduce((sum, row) => sum + Number(row.mood ?? 0), 0) / rows.length) * 10) / 10
    : null;
  return { ok: true, result: { days, total: rows.length, average_mood: average, checkins: data ?? [] } };
}

/** Configuração admin do motor emocional-financeiro (com defaults seguros). */
async function loadEmotionFinanceSettings(ctx: ToolContext) {
  const fallback = {
    window_days: 1,
    min_sample: DEFAULT_MIN_SAMPLE,
    min_composite_sample: DEFAULT_MIN_COMPOSITE_SAMPLE,
    min_uplift_pct: DEFAULT_MIN_UPLIFT_PCT,
    min_delta_abs: DEFAULT_MIN_DELTA_ABS,
    lookback_days: 120,
    prospective_enabled: true,
    prospective_channels: ["app", "whatsapp"] as string[],
  };
  try {
    const { data } = await ctx.sb.rpc("emotion_finance_settings");
    const cfg = (data ?? {}) as Record<string, unknown>;
    return {
      window_days: Number(cfg.window_days ?? fallback.window_days),
      min_sample: Number(cfg.min_sample ?? fallback.min_sample),
      min_composite_sample: Number(cfg.min_composite_sample ?? fallback.min_composite_sample),
      min_uplift_pct: Number(cfg.min_uplift_pct ?? fallback.min_uplift_pct),
      min_delta_abs: Number(cfg.min_delta_abs ?? fallback.min_delta_abs),
      lookback_days: Number(cfg.lookback_days ?? fallback.lookback_days),
      prospective_enabled: cfg.prospective_enabled !== false,
      prospective_channels: Array.isArray(cfg.prospective_channels)
        ? (cfg.prospective_channels as string[])
        : fallback.prospective_channels,
    };
  } catch {
    return fallback;
  }
}

/**
 * Padrões emoção × gasto do próprio usuário (`emotion_finance.v1`).
 * O cálculo é 100% determinístico e comparado ao baseline pessoal por dia da
 * semana. Associação observada — nunca causa.
 */
async function get_emotion_finance_patterns(
  ctx: ToolContext,
  args: { days?: number; emotion?: string },
): Promise<ToolResult> {
  const cfg = await loadEmotionFinanceSettings(ctx);
  const days = Math.min(365, Math.max(30, Number(args?.days ?? cfg.lookback_days)));
  const today = todaySP();
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const period = { from: start.toISOString().slice(0, 10), to: today };

  const [{ txs, names }, checkinsResult, cardsResult] = await Promise.all([
    loadTxAndCategories(ctx, period.from, period.to),
    ctx.sb.from("emotional_checkins")
      .select("occurred_at,mood,emotion_key,trigger_label")
      .eq("user_id", ctx.user_id)
      .gte("occurred_at", `${period.from}T00:00:00`)
      .order("occurred_at", { ascending: false })
      .limit(400),
    ctx.sb.from("credit_cards").select("closing_day").eq("user_id", ctx.user_id),
  ]);
  if (checkinsResult.error) {
    return { ok: false, error: "emotional_checkins_failed", details: checkinsResult.error.message };
  }

  const checkins = (checkinsResult.data ?? []) as Array<{
    occurred_at: string; mood: number; emotion_key: string | null; trigger_label: string | null;
  }>;
  if (checkins.length === 0) {
    return {
      ok: true,
      result: {
        engine: "emotion_finance",
        has_patterns: false,
        reason: "no_checkins",
        message: "Ainda não há registros de como você se sentiu, então não tenho base para cruzar emoção com gasto.",
      },
    };
  }

  const cardCloseDays = ((cardsResult.data ?? []) as Array<{ closing_day: number | null }>)
    .map((c) => Number(c.closing_day))
    .filter((d) => Number.isFinite(d) && d >= 1 && d <= 31);

  const envelope = computeEmotionFinance({
    txs: txs as unknown as TransactionRow[],
    checkins,
    period,
    categoryNames: Object.fromEntries(names.entries()),
    resolveEmotionKey: (value, mood) => {
      const option = resolveEmotionTerm(value) ?? emotionByKey(value) ?? moodToEmotion(mood);
      return option ? { key: option.key, label: option.label } : null;
    },
    minSample: cfg.min_sample,
    minCompositeSample: cfg.min_composite_sample,
    minUpliftPct: cfg.min_uplift_pct,
    minDeltaAbs: cfg.min_delta_abs,
    windowDays: cfg.window_days,
    cardCloseDays,
  });

  const wanted = args?.emotion
    ? (resolveEmotionTerm(args.emotion) ?? emotionByKey(args.emotion))?.key ?? null
    : null;
  const patterns = wanted
    ? envelope.facts.patterns.filter((p) => p.facts.emotion_key === wanted)
    : envelope.facts.patterns;

  return {
    ok: true,
    result: {
      engine: envelope.engine,
      formula_version: envelope.evidence.formula_version,
      has_patterns: patterns.some((p) => p.facts.material),
      period,
      confidence: envelope.confidence,
      checkins_considered: envelope.facts.checkins_considered,
      episodes_considered: envelope.facts.episodes_considered,
      patterns: patterns.slice(0, 6).map((p) => ({
        emotion_key: p.facts.emotion_key,
        emotion_label: p.facts.emotion_label,
        sample_size: p.facts.sample_size,
        direction: p.facts.direction,
        uplift_pct: p.facts.uplift_pct,
        observed_avg: p.facts.observed_avg,
        expected_avg: p.facts.expected_avg,
        delta_abs: p.facts.delta_abs,
        consistency: `${p.facts.consistency_hits}/${p.facts.sample_size}`,
        material: p.facts.material,
        confidence: p.confidence,
        top_driver: p.drivers[0]?.category_name ?? null,
        sentence: p.sentence,
      })),
      composites: envelope.facts.composites.slice(0, 3).map((p) => ({
        emotion_label: p.facts.emotion_label,
        context: p.context,
        context_label: p.context_label,
        sample_size: p.facts.sample_size,
        uplift_pct: p.facts.uplift_pct,
        sentence: p.sentence,
      })),
      language_rule: "É associação observada no histórico da pessoa. Nunca afirmar causa ('porque', 'causou', 'por estar').",
      evidence: envelope.evidence,
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

    name: "get_goal_strategy",
    description: "Monta o plano determinístico para atingir uma meta: quanto guardar por mês e por semana, de onde tirar o dinheiro (sobra e categorias acima da própria média), viabilidade do prazo, alternativas honestas quando não fecha e o próximo passo. Use sempre que o usuário pedir ajuda, direção, dicas ou estratégia para alcançar uma meta.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Nome ou parte do nome da meta. Vazio retorna todas as metas ativas." },
      },
      additionalProperties: false,
    },
    execute: get_goal_strategy,
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
  {
    name: "analyze_merchants",
    description: "Ranking de ESTABELECIMENTOS (onde/em quem o dinheiro sai), líquido de estornos, com variação vs período anterior e o driver (frequência x ticket x novo). Use para 'onde meu dinheiro está escapando', 'com quem gasto mais', 'quem consome meu dinheiro'.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 7, maximum: 730 },
        from: optionalStr, to: optionalStr,
        category_id: optionalStr, category_name: optionalStr,
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
    execute: analyze_merchants,
  },
  {
    name: "merchant_distribution",
    description: "DISTRIBUIÇÃO determinística de uma CATEGORIA por estabelecimento: total real da categoria, total identificado, cobertura e share de cada estabelecimento sobre o TOTAL DA CATEGORIA. Use para 'como está a distribuição da categoria X', 'onde mais gastei em X', 'quais estabelecimentos pesaram na categoria'. Nunca calcule percentual por conta própria.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 7, maximum: 730 },
        from: optionalStr, to: optionalStr,
        category_id: optionalStr, category_name: optionalStr,
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
    execute: merchant_distribution,
  },
  {
    name: "merchant_profile",
    description: "Perfil de UM estabelecimento: total líquido, número de compras, ticket médio, maior compra, dia da semana típico e variação vs período anterior. Use para 'quanto gastei com iFood/Uber/mercado X'.",
    parameters: {
      type: "object",
      properties: {
        query: requiredStr,
        days: { type: "integer", minimum: 7, maximum: 730 },
        from: optionalStr, to: optionalStr,
      },
      required: ["query"], additionalProperties: false,
    },
    execute: merchant_profile,
  },
  {
    name: "explain_behavior_change",
    description: "Explica a MUDANÇA DE COMPORTAMENTO: decompõe a variação do gasto em efeito frequência, efeito ticket, estabelecimentos novos e abandonados (a soma fecha exatamente o delta), com categorias responsáveis e mix por dia da semana. Use para 'por que gastei mais', 'o que mudou no meu comportamento'.",
    parameters: {
      type: "object",
      properties: { days: { type: "integer", minimum: 7, maximum: 365 } },
      additionalProperties: false,
    },
    execute: explain_behavior_change,
  },
  {
    name: "discover_recurring",
    description: "Descobre ASSINATURAS e cobranças recorrentes pelos lançamentos (cadência estável), com valor mensal equivalente, próxima cobrança esperada, saltos de preço e cobranças que pararam. Use para 'quais assinaturas eu tenho', 'o que fica debitando todo mês'.",
    parameters: {
      type: "object",
      properties: { days: { type: "integer", minimum: 60, maximum: 730 } },
      additionalProperties: false,
    },
    execute: discover_recurring,
  },
  {
    name: "analyze_cost_structure",
    description: "Divide o gasto entre CUSTO ESTRUTURAL (fixo, sai antes de qualquer decisão) e CONSUMO FLEXÍVEL, com custo mínimo mensal, sobra média (headroom) e fatia da renda comprometida. Use para 'quanto custa minha vida', 'quanto é fixo x variável', 'do que eu não consigo escapar'.",
    parameters: {
      type: "object",
      properties: { months: { type: "integer", minimum: 1, maximum: 12 } },
      additionalProperties: false,
    },
    execute: analyze_cost_structure,
  },
  {
    name: "detect_spending_anomalies",
    description: "Detecta o que está FORA DO PADRÃO PESSOAL (banda mediana ± 1,5 MAD) por estabelecimento, categoria e ticket, além de recordes históricos. Use para 'algo fora do normal', 'gastei demais essa semana?', 'anomalias'.",
    parameters: {
      type: "object",
      properties: { days: { type: "integer", minimum: 7, maximum: 90 }, history_days: { type: "integer", minimum: 30, maximum: 365 } },
      additionalProperties: false,
    },
    execute: detect_spending_anomalies,
  },
  {
    name: "find_savings_opportunities",
    description: "Oportunidades REAIS de economia (vazamentos, excesso sobre o próprio hábito, assinaturas paradas, pequenos valores repetidos), com valor mensal recuperável e sem cortar custo estrutural. Use para 'onde consigo economizar', 'como sobrar mais dinheiro'.",
    parameters: {
      type: "object",
      properties: { days: { type: "integer", minimum: 30, maximum: 365 } },
      additionalProperties: false,
    },
    execute: find_savings_opportunities,
  },
  {
    name: "compare_financial_metric",
    description: "COMPARAÇÃO canônica de qualquer métrica financeira entre dois períodos, com recorte explícito (mês corrente x mesmo trecho do mês anterior, semana x semana, dias úteis equivalentes, período custom) e explicação da variação por categoria, estabelecimento e fixo/flexível. Use para 'gastei mais que mês passado?', 'comparado à semana passada', 'como está esse mês contra o anterior', 'minha renda caiu?'.",
    parameters: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["expense", "income", "net", "savings_rate", "category_spend", "merchant_spend", "transaction_count", "average_ticket", "card_spend", "cash_flow", "debt_payment", "investment_flow", "commitment_load"] },
        mode: { type: "string", enum: ["MTD_EQUIVALENT", "MTD", "MONTH_OVER_MONTH", "WEEK_OVER_WEEK", "PREVIOUS_EQUIVALENT_PERIOD", "SAME_CALENDAR_DAYS_PREVIOUS_MONTH", "SAME_BUSINESS_DAY_INDEX_PREVIOUS_MONTH", "ROLLING_WINDOW", "YEAR_OVER_YEAR", "CUSTOM_PERIOD"] },
        day_selection: { type: "string", enum: ["CHRONOLOGICAL", "BUSINESS_DAYS_ONLY"] },
        category_name: optionalStr,
        merchant: optionalStr,
        from: optionalStr,
        to: optionalStr,
        window_days: { type: "integer", minimum: 7, maximum: 365 },
      },
      additionalProperties: false,
    },
    execute: compare_financial_metric,
  },
  {
    name: "assess_financial_performance",
    description: "RESPOSTA EXECUTIVA de 'como estou?': o que mudou de verdade, se a mudança é estrutural, de hábito ou apenas de calendário (desembolso que ainda não veio), o principal avanço, o principal ponto de atenção e a próxima ação. Use para 'como estou?', 'estou melhorando?', 'minha performance financeira', 'evoluí esse mês?'.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["MTD_EQUIVALENT", "MONTH_OVER_MONTH", "ROLLING_WINDOW"] },
        materiality_floor: num,
      },
      additionalProperties: false,
    },
    execute: assess_financial_performance,
  },
  {
    name: "analyze_financial_evolution",
    description: "Evolução financeira longitudinal (30/90/180 dias): renda, gasto, resultado, taxa de poupança, tendência, volatilidade e melhor/pior mês. Use para 'estou melhorando?', 'como evoluí', 'minha vida financeira está mais estável?'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: analyze_financial_evolution,
  },
  {
    name: "analyze_longitudinal_trajectory",
    description: "TRAJETÓRIA LONGITUDINAL (vários meses): série mês a mês de renda, gasto, consumo flexível e resultado, tendência, volatilidade e PONTO DE VIRADA (quando o padrão mudou, e se a mudança veio de comportamento ou de renda). Use para 'estou melhor que no começo do ano', 'quando comecei a piorar', 'minha trajetória', 'nos últimos 12 meses'.",
    parameters: {
      type: "object",
      properties: {
        months: { type: "integer", minimum: 3, maximum: 36 },
        from: optionalStr,
        to: optionalStr,
      },
      additionalProperties: false,
    },
    execute: analyze_longitudinal_trajectory,
  },
  {
    name: "analyze_wealth_opportunity",
    description: "OPORTUNIDADE PATRIMONIAL: quanto o usuário poderia ter acumulado se tivesse mantido o próprio consumo flexível na mediana pessoal, em cenários de 25%/50%/70%, e quanto ele consegue guardar por mês de forma sustentável. Use para 'quanto eu poderia ter guardado', 'quanto consigo poupar por mês', 'quanto perdi gastando à mais', 'plano de patrimônio'. Nunca estime esses números fora desta tool.",
    parameters: {
      type: "object",
      properties: {
        months: { type: "integer", minimum: 3, maximum: 36 },
        annual_yield_pct: num,
      },
      additionalProperties: false,
    },
    execute: analyze_wealth_opportunity,
  },
  {
    name: "build_financial_plan",
    description: "PLANO FINANCEIRO COMPLETO (financial_plan.v1): liga trajetória longitudinal + capacidade sustentável de poupança + oportunidade patrimonial + estratégia da meta em um plano com passos e alternativas. Use para 'monte um plano para eu chegar a X', 'como saio de onde estou para a minha meta', 'plano para juntar R$ 20 mil'. Nunca monte esse plano de cabeça.",
    parameters: {
      type: "object",
      properties: {
        target_amount: num,
        target_date: optionalStr,
        goal: optionalStr,
        months: { type: "integer", minimum: 3, maximum: 36 },
        annual_yield_pct: num,
      },
      additionalProperties: false,
    },
    execute: build_financial_plan,
  },
  {
    name: "get_debt_status",
    description: "Situação das DÍVIDAS: parcelas vencidas sem pagamento registrado (atraso, com dias e valor), próxima parcela a vencer e dívidas sem agenda cadastrada. Use para 'estou atrasado em alguma dívida', 'qual parcela vence agora', 'minhas dívidas'.",
    parameters: {
      type: "object",
      properties: { due_soon_days: { type: "integer", minimum: 1, maximum: 15 } },
      additionalProperties: false,
    },
    execute: get_debt_status,
  },
  {
    name: "plan_installment_decision",
    description: "CONSULTORIA: diz se o usuário consegue assumir um gasto/parcela, com linha do tempo mês a mês (folga antes e depois), meses que ficam apertados, quanto precisa liberar por mês e onde cortar. Use para 'consigo pagar', 'cabe no meu mês', 'vale a pena parcelar em Nx', 'impacto dessa parcela', 'quanto consigo reduzir para caber'.",
    parameters: {
      type: "object",
      properties: {
        amount: num,
        installments: { type: "integer", minimum: 1, maximum: 48 },
        method: { type: "string", enum: ["cash", "card"] },
        description: optionalStr,
      },
      required: ["amount"], additionalProperties: false,
    },
    execute: plan_installment_decision,
  },
  {
    name: "log_emotional_checkin",
    description: "Registra COMO O USUÁRIO SE SENTIU hoje (check-in emocional). Use quando a pessoa disser o que está sentindo ou responder ao lembrete de humor: 'hoje fui ansioso', 'estou tranquilo', 'registra que estou cansado', 'me senti culpado com essa compra'. Grava um único registro por dia (atualiza se já existir).",
    parameters: {
      type: "object",
      properties: {
        emotion: { type: "string", description: "Sentimento em pt-BR (tranquilo, atento, preocupado, confiante, impulsivo, frustrado, celebrando, culpado) ou a palavra usada pela pessoa." },
        mood: { type: "integer", minimum: 1, maximum: 5, description: "Escala 1 (muito ruim) a 5 (muito bem), quando a pessoa der nota." },
        notes: { type: "string", description: "Observação curta que a pessoa contou." },
      },
      additionalProperties: false,
    },
    execute: log_emotional_checkin,
  },
  {
    name: "get_emotional_checkins",
    description: "Histórico dos check-ins emocionais registrados (humor médio e registros recentes). Use para responder 'como eu estive', 'qual meu humor no mês' e para relacionar emoção com gasto.",
    parameters: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 90 } },
      additionalProperties: false,
    },
    execute: get_emotional_checkins,
  },
  {
    name: "get_emotion_finance_patterns",
    description: "Cruza os check-ins emocionais com o gasto flexível do próprio usuário e devolve associações observadas contra o baseline pessoal do mesmo dia da semana. Use para 'o que acontece quando eu fico ansioso', 'minha emoção influencia meu gasto?', 'o que costuma acontecer antes de eu gastar'. É associação, nunca causa.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 30, maximum: 365, description: "Janela de histórico analisada." },
        emotion: { type: "string", description: "Filtra por um sentimento específico (opcional)." },
      },
      additionalProperties: false,
    },
    execute: get_emotion_finance_patterns,
  },
  {
    name: "get_net_worth",
    description: "Patrimônio líquido com composição: dinheiro em conta, investido, cheque especial, fatura de cartão em aberto e outras dívidas. Use para 'qual meu patrimônio', 'quanto eu tenho no total'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: get_net_worth,
  },
  {
    name: "list_investments",
    description: "Carteira de investimentos do usuário: itens, valor investido, valor atual, resultado e distribuição por categoria.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: list_investments,
  },
  {
    name: "get_future_installments",
    description: "Parcelas de cartão que ainda vão cair, por mês de competência. Use para 'quanto ainda tenho parcelado', 'o que já está comprometido nos próximos meses'.",
    parameters: {
      type: "object",
      properties: { months: { type: "integer", minimum: 1, maximum: 24 } },
      additionalProperties: false,
    },
    execute: get_future_installments,
  },
  {
    name: "list_recurring_rules",
    description: "Recorrências ativas do usuário (assinaturas e contas fixas), com total mensal de entradas e saídas.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: list_recurring_rules,
  },
  {
    name: "get_commitments_agenda",
    description: "Agenda canônica de compromissos dos próximos dias: faturas, parcelas, dívidas e recorrências com data e valor. Use para 'o que vence agora', 'quais contas estão chegando'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: get_commitments_agenda,
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
