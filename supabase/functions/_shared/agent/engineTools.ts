// Tools dos motores determinísticos do Nino (`nino_engines.v1`).
//
// Cada tool: carrega fatos do usuário, chama o motor canônico espelhado em
// `finance-core/` e devolve o envelope completo (facts + breakdown + drivers +
// evidence + confidence) já acompanhado do bloco `answer_format`.
// A LLM nunca calcula: ela lê estes campos e explica.

// deno-lint-ignore-file no-explicit-any
type SupabaseClient = any;

import { rankMerchants, merchantProfile, computeMerchantStats, merchantDistribution } from "../finance-core/merchantIntelligence.ts";
import { computeBehaviorChange } from "../finance-core/behaviorChange.ts";
import { discoverRecurring } from "../finance-core/recurringDiscovery.ts";
import { computeCostStructure } from "../finance-core/costStructure.ts";
import { detectAnomalies } from "../finance-core/anomalies.ts";
import { computeSavingsOpportunities } from "../finance-core/savingsOpportunities.ts";
import { computeFinancialEvolution } from "../finance-core/financialEvolution.ts";
import { computeDebtStatus } from "../finance-core/debtStatus.ts";
import { buildMerchantResolver, type MerchantAliasRow } from "../finance-core/merchant.ts";
import { previousWindow, shiftDays, type EnginePeriod } from "../finance-core/engineEnvelope.ts";
import { withAnswerFormat, brl, formatDatePt } from "./answerFormat.ts";
import { todaySaoPaulo } from "./parser.ts";

const ENGINE_TX_SELECT = "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,"
  + "payment_method,credit_card_id,settles_card_id,movement_kind,posted_at,posted_at_source,"
  + "competence_date,investment_id,refund_of_transaction_id";

const PAGE = 1_000;
const MAX_ROWS = 100_000;

export type EngineToolContext = { sb: SupabaseClient; user_id: string };

async function loadEngineTransactions(
  ctx: EngineToolContext,
  from: string,
  to: string,
): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await ctx.sb.from("transactions")
      .select(ENGINE_TX_SELECT)
      .eq("user_id", ctx.user_id)
      .gte("occurred_at", from)
      .lte("occurred_at", to)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`transactions_query_failed:${error.message}`);
    const page = (data ?? []) as any[];
    rows.push(...page.map((r) => ({ ...r, amount: Number(r.amount) })));
    if (page.length < PAGE) return rows;
  }
  throw new Error(`transactions_query_exceeded_${MAX_ROWS}_rows`);
}

async function loadCategoryNames(ctx: EngineToolContext): Promise<Record<string, string>> {
  const { data, error } = await ctx.sb.from("categories")
    .select("id,name")
    .or(`user_id.eq.${ctx.user_id},user_id.is.null`)
    .is("archived_at", null);
  if (error) throw new Error(`categories_query_failed:${error.message}`);
  const out: Record<string, string> = {};
  for (const c of data ?? []) out[c.id] = c.name;
  return out;
}

async function loadAliases(ctx: EngineToolContext): Promise<MerchantAliasRow[]> {
  const { data, error } = await ctx.sb.from("merchant_aliases")
    .select("alias_key,friendly_name,hits")
    .eq("user_id", ctx.user_id);
  if (error) return [];
  return (data ?? []).map((a: any) => ({
    alias_normalized: a.alias_key,
    canonical_name: a.friendly_name,
    confidence: Math.min(1, 0.5 + Number(a.hits ?? 1) / 20),
  }));
}

function windowFor(days: number, to?: string): EnginePeriod {
  const end = (to ?? todaySaoPaulo()).slice(0, 10);
  return { from: shiftDays(end, -(Math.max(1, days) - 1)), to: end };
}

function clampDays(value: unknown, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(7, Math.min(730, Math.round(n)));
}

/**
 * Período explícito (`period_truth.v1`) tem prioridade sobre `days`.
 * Sem período e sem `days`, cai no fallback do chamador.
 */
function periodFromArgs(args: { from?: string; to?: string; days?: number }, fallbackDays: number): EnginePeriod {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(args?.from ?? "").slice(0, 10);
  const to = String(args?.to ?? "").slice(0, 10);
  if (ymd.test(from) && ymd.test(to) && from <= to) return { from, to };
  if (ymd.test(from) && !ymd.test(to)) return { from, to: todaySaoPaulo().slice(0, 10) };
  return windowFor(clampDays(args?.days, fallbackDays), ymd.test(to) ? to : undefined);
}

/** Resolve nome de categoria informado pelo usuário para id (match exato > prefixo). */
async function resolveCategoryId(
  ctx: EngineToolContext,
  args: { category_id?: string; category_name?: string },
): Promise<string | null> {
  const explicit = String(args?.category_id ?? "").trim();
  if (explicit) return explicit;
  const wanted = String(args?.category_name ?? "").trim();
  if (!wanted) return null;
  const names = await loadCategoryNames(ctx);
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const target = norm(wanted);
  const entries = Object.entries(names);
  return entries.find(([, name]) => norm(name) === target)?.[0]
    ?? entries.find(([, name]) => norm(name).startsWith(target) || target.startsWith(norm(name)))?.[0]
    ?? null;
}

type EngineToolResult = { ok: true; result: any } | { ok: false; error: string };

async function guard(fn: () => Promise<any>): Promise<EngineToolResult> {
  try {
    return { ok: true, result: await fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------- merchants

export function analyze_merchants(
  ctx: EngineToolContext,
  args: { days?: number; from?: string; to?: string; category_id?: string; category_name?: string; limit?: number },
): Promise<EngineToolResult> {
  return guard(async () => {
    const period = periodFromArgs(args ?? {}, 30);
    const comparison = previousWindow(period);
    const [txs, aliases, categoryId] = await Promise.all([
      loadEngineTransactions(ctx, comparison.from, period.to),
      loadAliases(ctx),
      resolveCategoryId(ctx, args ?? {}),
    ]);
    const env = rankMerchants({
      txs: txs as any,
      period,
      comparisonPeriod: comparison,
      aliases,
      categoryId,
      limit: Math.max(3, Math.min(25, Number(args?.limit ?? 10))),
    });
    const top = env.facts.top_merchant;
    const share = top && env.facts.period_net_total > 0
      ? ` (${Math.round((top.net_total / env.facts.period_net_total) * 100)}% do período)`
      : "";
    const headline = top
      ? `Entre ${period.from} e ${period.to}, ${brl(env.facts.period_net_total)} saíram em estabelecimentos identificados; ${top.label} lidera com ${brl(top.net_total)}${share}.`
      : `Entre ${period.from} e ${period.to}, ${brl(env.facts.period_net_total)} saíram em estabelecimentos identificados.`;
    return withAnswerFormat(
      { ...env, facts: { ...env.facts, period, category_id: categoryId } },
      headline,
      env.facts.delta_abs,
    );
  });
}

/**
 * Distribuição determinística por estabelecimento dentro de uma categoria
 * (`merchant_distribution.v1`). A LLM não calcula valor nem percentual: o
 * denominador do share é SEMPRE o total real da categoria no período.
 */
export function merchant_distribution(
  ctx: EngineToolContext,
  args: { days?: number; from?: string; to?: string; category_id?: string; category_name?: string; limit?: number },
): Promise<EngineToolResult> {
  return guard(async () => {
    const period = periodFromArgs(args ?? {}, 30);
    const [txs, aliases, categoryId, names] = await Promise.all([
      loadEngineTransactions(ctx, period.from, period.to),
      loadAliases(ctx),
      resolveCategoryId(ctx, args ?? {}),
      loadCategoryNames(ctx),
    ]);
    const categoryName = categoryId ? (names[categoryId] ?? null) : (args?.category_name ?? null);
    const dist = merchantDistribution({
      txs: txs as any,
      period,
      aliases,
      categoryId,
      categoryName,
      limit: Math.max(3, Math.min(25, Number(args?.limit ?? 8))),
    });
    return { ...dist, engine: "merchant_distribution", answer_format: { headline: distributionHeadline(dist) } };
  });
}

/** Headline canônica da distribuição — declara cobertura quando parcial. */
export function distributionHeadline(dist: {
  category: { name: string | null };
  category_total: number;
  resolved_total: number;
  coverage: number;
  merchants: Array<{ merchant: string; amount: number; share_of_category: number }>;
  period: { from: string; to: string };
}): string {
  const scope = dist.category.name ? `em ${dist.category.name}` : "no período";
  if (dist.category_total <= 0) {
    return `Não encontrei gastos ${scope} entre ${formatDatePt(dist.period.from)} e ${formatDatePt(dist.period.to)}.`;
  }
  const top = dist.merchants[0];
  const base = `Você gastou ${brl(dist.category_total)} ${scope} entre ${formatDatePt(dist.period.from)} e ${formatDatePt(dist.period.to)}`;
  const lead = top
    ? `; ${top.merchant} lidera com ${brl(top.amount)} (${Math.round(top.share_of_category * 100)}% da categoria)`
    : "";
  const cov = dist.coverage < 1
    ? `. Identifiquei o estabelecimento de ${brl(dist.resolved_total)} desse total (${Math.round(dist.coverage * 100)}% de cobertura)`
    : "";
  return `${base}${lead}${cov}.`;
}



export function merchant_profile(
  ctx: EngineToolContext,
  args: { query: string; days?: number; from?: string; to?: string },
): Promise<EngineToolResult> {
  return guard(async () => {
    const period = periodFromArgs(args ?? ({} as any), 90);
    const comparison = previousWindow(period);
    const [txs, aliases] = await Promise.all([
      loadEngineTransactions(ctx, comparison.from, period.to),
      loadAliases(ctx),
    ]);
    const env = merchantProfile({
      txs: txs as any,
      period,
      comparisonPeriod: comparison,
      aliases,
      query: String(args?.query ?? ""),
    });
    const f = env.facts;
    const headline = f.found
      ? `${f.label}: ${brl(f.net_total)} em ${f.count} compra(s), ticket médio ${brl(f.avg_ticket)}.`
      : `Não encontrei lançamentos de “${f.query}” nessa janela.`;
    return withAnswerFormat(env, headline, f.delta_abs);
  });
}

// ---------------------------------------------------------- behavior change

export function explain_behavior_change(ctx: EngineToolContext, args: { days?: number }): Promise<EngineToolResult> {
  return guard(async () => {
    const days = clampDays(args?.days, 30);
    const period = windowFor(days);
    const comparison = previousWindow(period);
    const [txs, aliases, categoryNames] = await Promise.all([
      loadEngineTransactions(ctx, comparison.from, period.to),
      loadAliases(ctx),
      loadCategoryNames(ctx),
    ]);
    const env = computeBehaviorChange({
      txs: txs as any,
      period,
      comparisonPeriod: comparison,
      aliases,
      categoryNames,
    });
    const f = env.facts;
    const direction = f.delta_abs > 0 ? "aumentaram" : f.delta_abs < 0 ? "caíram" : "ficaram estáveis";
    const headline = `Seus gastos ${direction} ${brl(Math.abs(f.delta_abs))} (${brl(f.previous_total)} → ${brl(f.current_total)}).`;
    return withAnswerFormat(env, headline, f.delta_abs);
  });
}

// ------------------------------------------------------------- recurring

async function loadRegisteredRecurring(ctx: EngineToolContext) {
  const { data } = await ctx.sb.from("recurring_entries")
    .select("id,name,type,amount,frequency,next_due_date,active")
    .eq("user_id", ctx.user_id);
  return (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }));
}

export function discover_recurring(ctx: EngineToolContext, args: { days?: number }): Promise<EngineToolResult> {
  return guard(async () => {
    const days = clampDays(args?.days, 180);
    const period = windowFor(days);
    const [txs, aliases, registered] = await Promise.all([
      loadEngineTransactions(ctx, period.from, period.to),
      loadAliases(ctx),
      loadRegisteredRecurring(ctx),
    ]);
    const env = discoverRecurring({
      txs: txs as any,
      period,
      today: period.to,
      aliases,
      registered: registered as any,
    });
    const f = env.facts;
    const headline = f.subscriptions_count > 0
      ? `Encontrei ${f.subscriptions_count} cobrança(s) recorrente(s), somando ${brl(f.monthly_committed)} por mês.`
      : "Não identifiquei cobranças recorrentes com cadência estável nessa janela.";
    return withAnswerFormat(env, headline);
  });
}

// --------------------------------------------------------- cost structure

async function loadDebts(ctx: EngineToolContext) {
  const { data } = await ctx.sb.from("debts")
    .select("id,name,creditor,outstanding_balance,original_amount,installment_amount,due_day,status,installments_total,installments_paid,first_due_date,start_date,accounting_method")
    .eq("user_id", ctx.user_id);
  return (data ?? []).map((d: any) => ({
    ...d,
    outstanding_balance: Number(d.outstanding_balance ?? 0),
    original_amount: Number(d.original_amount ?? 0),
    installment_amount: d.installment_amount == null ? null : Number(d.installment_amount),
  }));
}

export function analyze_cost_structure(ctx: EngineToolContext, args: { months?: number }): Promise<EngineToolResult> {
  return guard(async () => {
    const months = Math.max(1, Math.min(12, Number(args?.months ?? 3)));
    const period = windowFor(months * 30);
    const [txs, categoryNames, recurring, debts] = await Promise.all([
      loadEngineTransactions(ctx, period.from, period.to),
      loadCategoryNames(ctx),
      loadRegisteredRecurring(ctx),
      loadDebts(ctx),
    ]);
    const env = computeCostStructure({
      txs: txs as any,
      period,
      categoryNames,
      recurring: recurring as any,
      debts: debts as any,
      monthsAnalyzed: months,
    });
    const f = env.facts;
    const headline = `Custo estrutural médio de ${brl(f.structural_monthly)} por mês e ${brl(f.flexible_monthly)} de gasto flexível; sobra média de ${brl(f.headroom_monthly)}.`;
    return withAnswerFormat(env, headline);
  });
}

// ------------------------------------------------------------- anomalies

export function detect_spending_anomalies(ctx: EngineToolContext, args: { days?: number; history_days?: number }): Promise<EngineToolResult> {
  return guard(async () => {
    const days = clampDays(args?.days, 7);
    const historyDays = clampDays(args?.history_days, 120);
    const period = windowFor(days);
    const history: EnginePeriod = { from: shiftDays(period.from, -historyDays), to: shiftDays(period.from, -1) };
    const [txs, aliases, categoryNames] = await Promise.all([
      loadEngineTransactions(ctx, history.from, period.to),
      loadAliases(ctx),
      loadCategoryNames(ctx),
    ]);
    const env = detectAnomalies({ txs: txs as any, period, history, aliases, categoryNames });
    const f = env.facts;
    const headline = f.top
      ? `${f.anomalies_count} ponto(s) fora do seu padrão. O maior: ${f.top.label} com ${brl(f.top.observed)} contra ${brl(f.top.typical)} habituais.`
      : "Nada fora do seu padrão habitual nessa janela.";
    return withAnswerFormat(env, headline);
  });
}

// ---------------------------------------------------------------- savings

export function find_savings_opportunities(ctx: EngineToolContext, args: { days?: number }): Promise<EngineToolResult> {
  return guard(async () => {
    const days = clampDays(args?.days, 90);
    const period = windowFor(days);
    const comparison = previousWindow(period);
    const history: EnginePeriod = { from: shiftDays(period.from, -120), to: shiftDays(period.from, -1) };
    const [txs, aliases, categoryNames, recurring, debts] = await Promise.all([
      loadEngineTransactions(ctx, history.from, period.to),
      loadAliases(ctx),
      loadCategoryNames(ctx),
      loadRegisteredRecurring(ctx),
      loadDebts(ctx),
    ]);
    const resolver = buildMerchantResolver(aliases);
    const merchants = computeMerchantStats({ txs: txs as any, period, resolver });
    const previousMerchants = computeMerchantStats({ txs: txs as any, period: comparison, resolver });
    const subscriptions = discoverRecurring({
      txs: txs as any,
      period: { from: shiftDays(period.to, -179), to: period.to },
      today: period.to,
      resolver,
      registered: recurring as any,
    }).breakdown;
    const anomalies = detectAnomalies({
      txs: txs as any,
      period: windowFor(7, period.to),
      history,
      resolver,
      categoryNames,
    }).breakdown;
    const costStructure = computeCostStructure({
      txs: txs as any,
      period,
      categoryNames,
      recurring: recurring as any,
      debts: debts as any,
    }).facts;
    const env = computeSavingsOpportunities({
      period,
      merchants,
      previousMerchants,
      subscriptions,
      anomalies,
      costStructure,
      categoryNames,
    });
    const f = env.facts;
    const headline = f.opportunities_count > 0
      ? `Vejo ${brl(f.total_monthly_saving)} por mês recuperáveis sem cortar estrutura, em ${f.opportunities_count} frente(s).`
      : "Não encontrei economia clara sem mexer no seu custo estrutural.";
    return withAnswerFormat(env, headline);
  });
}

// -------------------------------------------------------------- evolution

export function analyze_financial_evolution(ctx: EngineToolContext, _args: Record<string, never>): Promise<EngineToolResult> {
  return guard(async () => {
    const today = todaySaoPaulo();
    const txs = await loadEngineTransactions(ctx, shiftDays(today, -400), today);
    const env = computeFinancialEvolution({ txs: txs as any, today });
    const f = env.facts;
    const w30 = env.breakdown.find((w) => w.key === "30d");
    const headline = w30
      ? `Nos últimos 30 dias entraram ${brl(w30.income)} e saíram ${brl(w30.expense)} (resultado ${brl(w30.net)}); a tendência está ${f.trend} e a estabilidade é ${f.stability}.`
      : `Tendência ${f.trend}, estabilidade ${f.stability}.`;
    return withAnswerFormat(env, headline);
  });
}

// ------------------------------------------------------------------ debts

export function get_debt_status(ctx: EngineToolContext, args: { due_soon_days?: number }): Promise<EngineToolResult> {
  return guard(async () => {
    const today = todaySaoPaulo();
    const debts = await loadDebts(ctx);
    const { data: payments } = await ctx.sb.from("debt_payments")
      .select("debt_id,paid_at,amount,installments_covered")
      .eq("user_id", ctx.user_id);
    const env = computeDebtStatus({
      debts: debts as any,
      payments: (payments ?? []).map((p: any) => ({ ...p, amount: Number(p.amount ?? 0) })),
      today,
      dueSoonDays: Math.max(1, Math.min(15, Number(args?.due_soon_days ?? 5))),
    });
    const f = env.facts;
    let headline: string;
    if (f.overdue_count > 0) {
      const w = f.worst!;
      headline = `Você tem ${f.overdue_count} dívida(s) em atraso, somando ${brl(f.overdue_amount)}. A mais crítica é ${w.name}, com ${w.overdue_installments} parcela(s) vencida(s) há ${w.days_overdue} dia(s).`;
    } else if (f.due_soon_count > 0) {
      const n = f.next_due!;
      headline = `Nada em atraso. A próxima parcela é de ${n.name}, ${brl(n.installment_amount ?? 0)} em ${formatDatePt(n.next_due_date)}.`;
    } else if (f.debts_analyzed === 0) {
      headline = "Você não tem dívidas ativas registradas.";
    } else {
      headline = f.next_due
        ? `Dívidas em dia. Próxima parcela: ${f.next_due.name}, ${brl(f.next_due.installment_amount ?? 0)} em ${formatDatePt(f.next_due.next_due_date)}.`
        : "Dívidas em dia.";
    }
    return withAnswerFormat(env, headline);
  });
}
