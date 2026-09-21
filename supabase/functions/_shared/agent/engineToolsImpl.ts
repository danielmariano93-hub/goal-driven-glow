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
import { computeLongitudinal } from "../finance-core/longitudinal.ts";
import { computeWealthOpportunity } from "../finance-core/wealthOpportunity.ts";
import { computeAgentSnapshot } from "../engine/metrics.ts";
import { historyFingerprint, persistFinancialProfile } from "./financialProfile.ts";
import { buildGoalStrategy, type GoalStrategy } from "../engine/goalStrategy.ts";
import { computeGoalStrategy } from "./goalStrategyTool.ts";

import {
  computeFinancialComparison,
  FINANCIAL_COMPARISON_VERSION,
  type ComparisonMetric,
  type ComparisonMode,
} from "../finance-core/financialComparison.ts";
import { computeFinancialPerformance } from "../finance-core/financialPerformance.ts";
import { computeAdvisorDecision } from "../finance-core/advisorRelevance.ts";
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
    // Escopo explícito no resultado: sem categoria resolvida, o total é de
    // TODAS as categorias e a resposta é obrigada a declarar isso.
    const scope = categoryId || categoryName ? "category" : "all_categories";
    return {
      ...dist,
      scope,
      engine: "merchant_distribution",
      answer_format: { headline: distributionHeadline({ ...dist, scope }) },
    };
  });
}

/** Headline canônica da distribuição — declara escopo e cobertura. */
export function distributionHeadline(dist: {
  category: { name: string | null };
  category_total: number;
  resolved_total: number;
  coverage: number;
  merchants: Array<{ merchant: string; amount: number; share_of_category: number }>;
  period: { from: string; to: string };
  scope?: string;
}): string {
  const globalScope = dist.scope === "all_categories" || !dist.category.name;
  const scope = globalScope ? "considerando todas as categorias" : `em ${dist.category.name}`;
  if (dist.category_total <= 0) {
    return `Não encontrei gastos ${scope} entre ${formatDatePt(dist.period.from)} e ${formatDatePt(dist.period.to)}.`;
  }
  const top = dist.merchants[0];
  const base = `Você gastou ${brl(dist.category_total)} ${scope} entre ${formatDatePt(dist.period.from)} e ${formatDatePt(dist.period.to)}`;
  const lead = top
    ? `; ${top.merchant} lidera com ${brl(top.amount)} (${Math.round(top.share_of_category * 100)}% do total${globalScope ? "" : " da categoria"})`
    : "";
  const cov = dist.coverage < 1
    ? `. Reconheci o estabelecimento de ${brl(dist.resolved_total)} desse total (${Math.round(dist.coverage * 100)}% de cobertura)`
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

// ------------------------------------------------- comparação canônica v1

const COMPARISON_METRICS = new Set<ComparisonMetric>([
  "expense", "income", "net", "savings_rate", "category_spend", "merchant_spend",
  "transaction_count", "average_ticket", "card_spend", "cash_flow", "debt_payment",
  "investment_flow", "commitment_load",
]);

const COMPARISON_MODES = new Set<ComparisonMode>([
  "PREVIOUS_EQUIVALENT_PERIOD", "SAME_CALENDAR_DAYS_PREVIOUS_MONTH", "SAME_NUMBER_OF_ELAPSED_DAYS",
  "SAME_BUSINESS_DAY_INDEX_PREVIOUS_MONTH", "SAME_BUSINESS_DAYS_RANGE", "WEEK_OVER_WEEK",
  "MONTH_OVER_MONTH", "MTD", "MTD_EQUIVALENT", "ROLLING_WINDOW", "YEAR_OVER_YEAR", "CUSTOM_PERIOD",
]);

/**
 * `financial_comparison.v1` como tool única de comparação.
 * Qualquer "gastei mais/menos que", "comparado a", "este mês x mês passado"
 * passa por aqui: o recorte fica explícito em `methodology` e os drivers
 * explicam a variação por vários eixos.
 */
export function compare_financial_metric(
  ctx: EngineToolContext,
  args: {
    metric?: string; mode?: string; day_selection?: string;
    category_name?: string; category_id?: string; merchant?: string;
    from?: string; to?: string; window_days?: number;
  },
): Promise<EngineToolResult> {
  return guard(async () => {
    const today = todaySaoPaulo().slice(0, 10);
    const metric = (COMPARISON_METRICS.has(String(args?.metric) as ComparisonMetric)
      ? String(args?.metric) : "expense") as ComparisonMetric;
    const mode = (COMPARISON_MODES.has(String(args?.mode) as ComparisonMode)
      ? String(args?.mode) : "MTD_EQUIVALENT") as ComparisonMode;
    const [txs, names] = await Promise.all([
      loadEngineTransactions(ctx, shiftDays(today, -800), today),
      loadCategoryNames(ctx),
    ]);
    const categoryId = metric === "category_spend" ? await resolveCategoryId(ctx, args) : null;
    if (metric === "category_spend" && !categoryId) throw new Error("category_not_found");
    const merchant = String(args?.merchant ?? "").trim();
    if (metric === "merchant_spend" && !merchant) throw new Error("merchant_required");

    const explicitPeriod = /^\d{4}-\d{2}-\d{2}$/.test(String(args?.from ?? ""))
      && /^\d{4}-\d{2}-\d{2}$/.test(String(args?.to ?? ""));
    const result = computeFinancialComparison({
      txs: txs as any,
      categoryNames: new Map(Object.entries(names)),
      metric,
      scope: metric === "category_spend" ? "category" : metric === "merchant_spend" ? "merchant" : "overall",
      subject_id: categoryId,
      subject_label: metric === "merchant_spend" ? merchant : (categoryId ? names[categoryId] ?? null : null),
      mode: explicitPeriod ? "CUSTOM_PERIOD" : mode,
      as_of: today,
      day_selection: args?.day_selection === "BUSINESS_DAYS_ONLY" ? "BUSINESS_DAYS_ONLY" : "CHRONOLOGICAL",
      current_period: explicitPeriod ? { from: String(args!.from).slice(0, 10), to: String(args!.to).slice(0, 10) } : undefined,
      window_days: Number(args?.window_days ?? 30),
    });

    const dir = result.direction === "up" ? "subiu" : result.direction === "down" ? "caiu" : "ficou estável";
    const pct = result.delta_pct === null ? "" : ` (${result.delta_pct > 0 ? "+" : ""}${result.delta_pct.toFixed(1)}%)`;
    const subject = result.subject_label ? ` em ${result.subject_label}` : "";
    const headline = `${brl(result.current.value)}${subject} contra ${brl(result.previous.value)} — ${dir} ${brl(Math.abs(result.delta_abs))}${pct}.`;
    const top = result.drivers.slice(0, 3)
      .map((d) => `${d.label}: ${d.delta_abs > 0 ? "+" : ""}${brl(d.delta_abs)}`)
      .join(" · ");
    return {
      ...result,
      answer_format: {
        version: "nino_answer_format.v1",
        headline,
        delta_line: top || null,
        evidence_line: result.methodology,
        confidence_label: result.confidence,
      },
    };
  });
}

// ------------------------------------- performance executiva ("como estou?")

/**
 * `financial_performance.v1` + `advisor_relevance.v1`.
 * Responde "como estou?" com o que MUDOU, por que mudou (timing x estrutura x
 * comportamento) e a próxima ação. Nunca chama melhora o que é só calendário.
 */
export function assess_financial_performance(
  ctx: EngineToolContext,
  args: { mode?: string; materiality_floor?: number },
): Promise<EngineToolResult> {
  return guard(async () => {
    const today = todaySaoPaulo().slice(0, 10);
    const [txs, names] = await Promise.all([
      loadEngineTransactions(ctx, shiftDays(today, -420), today),
      loadCategoryNames(ctx),
    ]);
    const perf = computeFinancialPerformance({
      txs: txs as any,
      categoryNames: new Map(Object.entries(names)),
      as_of: today,
      mode: (COMPARISON_MODES.has(String(args?.mode) as ComparisonMode)
        ? String(args?.mode) : "MTD_EQUIVALENT") as ComparisonMode,
      materialityFloor: Number(args?.materiality_floor ?? 50),
    });
    const affinity = await loadTopicAffinity(ctx);
    const decision = computeAdvisorDecision({
      highlights: perf.highlights,
      affinity,
      as_of: today,
      channel: "app",
      maxItems: 3,
    });
    const main = decision.items[0] ?? null;
    const headline = decision.items.length
      ? `${perf.headline} ${main ? main.body : ""}`.trim()
      : perf.headline;
    return {
      engine: "financial_performance.v1",
      facts: {
        headline: perf.headline,
        main_improvement: decision.main_improvement,
        main_attention: decision.main_attention,
        next_action: decision.next_action,
      },
      highlights: decision.items,
      suppressed: decision.suppressed,
      comparisons: perf.comparisons,
      methodology: decision.methodology,
      answer_format: {
        version: "nino_answer_format.v1",
        headline,
        delta_line: main
          ? `Natureza: ${main.nature ?? "não classificada"}${main.recommended_action ? ` · ${main.recommended_action}` : ""}`
          : null,
        evidence_line: decision.methodology,
        confidence_label: main?.confidence ?? "insufficient_data",
      },
      formula_version: `${perf.formula_version}+${FINANCIAL_COMPARISON_VERSION}`,
    };
  });
}

/** Afinidade de tópicos aprendida — só ordena, nunca muda número. */
async function loadTopicAffinity(ctx: EngineToolContext) {
  const { data, error } = await ctx.sb.from("user_advisor_topic_affinity")
    .select("topic_key,score,signals,last_seen_at")
    .eq("user_id", ctx.user_id);
  if (error) return [];
  return (data ?? []).map((r: any) => ({
    topic_key: String(r.topic_key),
    score: Number(r.score ?? 0),
    signals: Number(r.signals ?? 0),
    last_seen: r.last_seen_at ? String(r.last_seen_at).slice(0, 10) : null,
  }));
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
      .select("debt_id,paid_at,amount,amount_applied,installments_covered")
      .eq("user_id", ctx.user_id);
    const env = computeDebtStatus({
      debts: debts as any,
      payments: (payments ?? []).map((p: any) => ({ ...p, amount: Number(p.amount ?? 0), amount_applied: p.amount_applied == null ? null : Number(p.amount_applied) })),
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

// --------------------------------------------------- longitudinal / wealth

function monthsAgo(months: number, to?: string): EnginePeriod {
  const end = (to ?? todaySaoPaulo()).slice(0, 10);
  const [y, m] = end.split("-").map(Number);
  const startMonthIndex = (y * 12 + (m - 1)) - Math.max(1, months - 1);
  const sy = Math.floor(startMonthIndex / 12);
  const sm = (startMonthIndex % 12) + 1;
  return { from: `${sy}-${String(sm).padStart(2, "0")}-01`, to: end };
}

/**
 * Trajetória longitudinal (`longitudinal_intelligence.v1`).
 * Responde "estou melhor que no início do ano?", "quando comecei a piorar?" e
 * "que comportamento explica isso?" — com série mensal, tendência e virada
 * calculadas pelo motor, nunca pela LLM.
 */
export function analyze_longitudinal_trajectory(
  ctx: EngineToolContext,
  args: { months?: number; from?: string; to?: string },
): Promise<EngineToolResult> {
  return guard(async () => {
    const months = Math.max(3, Math.min(36, Number(args?.months ?? 12)));
    const period = /^\d{4}-\d{2}-\d{2}$/.test(String(args?.from ?? ""))
      ? periodFromArgs(args as any, months * 30)
      : monthsAgo(months);
    const [txs, categoryNames] = await Promise.all([
      loadEngineTransactions(ctx, period.from, period.to),
      loadCategoryNames(ctx),
    ]);
    const env = computeLongitudinal({
      txs: txs as any,
      period,
      categoryNames,
      asOf: todaySaoPaulo().slice(0, 10),
    });
    const f = env.facts;
    const cp = f.change_point;
    const parts = [
      `Analisei ${f.closed_months_analyzed} meses fechados (${period.from} a ${period.to}).`,
      `O resultado médio recente é ${brl(f.result_trend.recent_average)} contra ${brl(f.result_trend.previous_average)} antes — tendência ${f.result_trend.direction}.`,
      `O consumo flexível está ${f.behavior_trend.direction} (mediana de ${brl(f.flexible_median)} por mês).`,
    ];
    if (f.open_month) {
      parts.push(`${f.open_month.month} ainda está em curso (${f.open_month.days_elapsed} de ${f.open_month.days_in_month} dias), então não conta como melhora: no ritmo atual fecharia em ${brl(f.open_month.flexible_expense_mtd_equivalent)} de consumo flexível.`);
    }
    if (cp) {
      parts.push(`A virada aconteceu em ${cp.month}: de ${brl(cp.before_average)} para ${brl(cp.after_average)} (${cp.direction}), há ${cp.duration_months} mês(es).`);
    }
    if (f.extraordinary_months.length > 0) {
      parts.push(`Isolei valores atípicos em ${f.extraordinary_months.map((m) => m.month).join(", ")} para não distorcer a média.`);
    }
    if (f.result_driven_by_income) {
      parts.push(`Atenção: a melhora vem de renda maior, não de mudança de comportamento.`);
    }
    return withAnswerFormat(env, parts.join(" "));
  });
}

/**
 * Patrimônio canônico (`finance_truth.v1`). Fonte ÚNICA: o snapshot financeiro
 * do agente — o mesmo que alimenta `get_net_worth`. Nenhuma capability
 * reconstrói patrimônio por conta própria, e falha de leitura NUNCA vira
 * patrimônio parcial: ela interrompe com erro explícito.
 */
async function resolveCanonicalNetWorth(
  ctx: EngineToolContext,
): Promise<{ net: number; composition: unknown; formula_version: string }> {
  const snap = await computeAgentSnapshot(ctx.sb, ctx.user_id);
  const net = Number((snap as any)?.net_worth);
  if (!Number.isFinite(net)) throw new Error("net_worth_unavailable");
  return {
    net,
    composition: (snap as any).net_worth_composition ?? null,
    formula_version: String((snap as any).formula_version ?? "finance_contract"),
  };
}

/**
 * Oportunidade patrimonial (`wealth_opportunity.v1`).
 * Responde "quanto eu poderia ter acumulado?" e "quanto consigo guardar por
 * mês?" usando a baseline do próprio usuário e capitalização por aporte, sempre
 * sobre o patrimônio CANÔNICO.
 */
export function analyze_wealth_opportunity(
  ctx: EngineToolContext,
  args: { months?: number; annual_yield_pct?: number },
): Promise<EngineToolResult> {
  return guard(async () => {
    const months = Math.max(3, Math.min(36, Number(args?.months ?? 12)));
    const period = monthsAgo(months);
    const [txs, categoryNames, netWorth, debts] = await Promise.all([
      loadEngineTransactions(ctx, period.from, period.to),
      loadCategoryNames(ctx),
      resolveCanonicalNetWorth(ctx),
      loadDebts(ctx),
    ]);
    const longitudinal = computeLongitudinal({
      txs: txs as any,
      period,
      categoryNames,
      asOf: todaySaoPaulo().slice(0, 10),
    });
    const commitments = (debts as any[]).filter((d: any) => d.status === "active")
      .reduce((acc: number, d: any) => acc + Number(d.installment_amount ?? 0), 0);
    const env = computeWealthOpportunity({
      longitudinal: longitudinal.facts,
      actualNetWorth: netWorth.net,
      period,
      monthlyCommitments: commitments,
      annualYieldPct: Number(args?.annual_yield_pct ?? 0),
      // Fontes do potencial: séries mensais por categoria flexível vindas do
      // próprio motor longitudinal (E2E — nada de drivers vazios).
      flexibleByCategory: longitudinal.facts.flexible_by_category,
    });
    const f = env.facts;
    const realistic = f.scenarios.find((s) => s.key === "realista")!;
    const sources = env.drivers ?? [];
    const sourceText = sources.length
      ? ` As fontes são ${sources.map((s: any) => `${s.label} (${brl(s.recoverable_monthly)}/mês)`).join(", ")}.`
      : "";
    // Financial Profile Learning: o perfil longitudinal fica gravado com o hash
    // do histórico — histórico novo recalcula, nada de perfil velho silencioso.
    await persistFinancialProfile(ctx.sb, {
      userId: ctx.user_id,
      asOf: todaySaoPaulo().slice(0, 10),
      period: { from: period.from, to: period.to },
      longitudinal: longitudinal.facts,
      wealth: f,
      sources: (env.drivers ?? []) as any,
      netWorth: netWorth.net,
      confidence: String(env.confidence ?? ""),
      transactionsHash: historyFingerprint(txs as any),
    }).catch(() => ({ ok: false }));

    const headline = f.recoverable_excess <= 0
      ? `Nos últimos ${f.months_analyzed} meses fechados seu consumo flexível ficou dentro da sua própria média (${brl(f.baseline_spending)}): não há excesso relevante para recuperar. Seu patrimônio hoje é ${brl(f.actual_net_worth)}.`
      : `Nos últimos ${f.months_analyzed} meses fechados você gastou ${brl(f.observed_spending)} em consumo flexível, ${brl(f.recoverable_excess)} acima da sua própria média. No cenário realista (metade desse excesso, ${brl(realistic.monthly_saving)} por mês), você teria ${brl(realistic.potential_net_worth)} em vez de ${brl(f.actual_net_worth)}. Dá para guardar ${brl(f.sustainable_monthly_saving)} por mês de forma sustentável.${sourceText}`;
    return withAnswerFormat(env, headline);
  });
}

/**
 * Plano financeiro composto (`financial_plan.v1`).
 * Fluxo determinístico completo, sem improviso da LLM:
 *  histórico → trajetória → capacidade sustentável de poupança →
 *  oportunidade patrimonial → meta desejada → `goal_strategy.v1` → passos.
 */
export function build_financial_plan(
  ctx: EngineToolContext,
  args: { target_amount?: number; target_date?: string; goal?: string; months?: number; annual_yield_pct?: number },
): Promise<EngineToolResult> {
  return guard(async () => {
    const months = Math.max(3, Math.min(36, Number(args?.months ?? 12)));
    const period = monthsAgo(months);
    const today = todaySaoPaulo().slice(0, 10);
    const [txs, categoryNames, netWorth, debts] = await Promise.all([
      loadEngineTransactions(ctx, period.from, period.to),
      loadCategoryNames(ctx),
      resolveCanonicalNetWorth(ctx),
      loadDebts(ctx),
    ]);
    const longitudinal = computeLongitudinal({ txs: txs as any, period, categoryNames, asOf: today });
    const commitments = (debts as any[]).filter((d: any) => d.status === "active")
      .reduce((acc: number, d: any) => acc + Number(d.installment_amount ?? 0), 0);
    const wealth = computeWealthOpportunity({
      longitudinal: longitudinal.facts,
      actualNetWorth: netWorth.net,
      period,
      monthlyCommitments: commitments,
      annualYieldPct: Number(args?.annual_yield_pct ?? 0),
      flexibleByCategory: longitudinal.facts.flexible_by_category,
    });

    const sustainable = wealth.facts.sustainable_monthly_saving;
    const closed = longitudinal.facts.closed_months;
    const monthlyIncome = closed.length
      ? Math.round((closed.reduce((a, m) => a + m.income_normalized, 0) / closed.length) * 100) / 100
      : 0;
    const monthlySurplus = closed.length
      ? Math.round((closed.reduce((a, m) => a + m.net, 0) / closed.length) * 100) / 100
      : 0;

    const target = Number(args?.target_amount ?? 0);
    let plan: GoalStrategy | null = null;
    let goalName = String(args?.goal ?? "").trim();

    if (target > 0) {
      plan = buildGoalStrategy({
        goalName: goalName || `Objetivo de ${brl(target)}`,
        targetAmount: target,
        // O patrimônio canônico já acumulado conta como ponto de partida.
        achievedAmount: Math.max(0, netWorth.net),
        targetDate: /^\d{4}-\d{2}-\d{2}$/.test(String(args?.target_date ?? "")) ? String(args?.target_date) : null,
        today,
        monthlyIncome,
        monthlySurplus,
        // Ritmo realista: o que o próprio histórico sustenta.
        currentMonthlyPace: sustainable,
        overspendCategories: (wealth.drivers ?? []).map((s: any) => ({
          name: s.label,
          monthlyAvg: s.observed_monthly,
          baseline: s.baseline_monthly,
        })),
      });
      goalName = plan.goalName;
    } else {
      // Sem meta informada, o plano é montado para as metas ativas do usuário.
      const strategy = await computeGoalStrategy(ctx.sb, ctx.user_id, { goal: goalName || undefined });
      plan = strategy.plans[0] ?? null;
      goalName = plan?.goalName ?? "";
    }

    await persistFinancialProfile(ctx.sb, {
      userId: ctx.user_id,
      asOf: today,
      period: { from: period.from, to: period.to },
      longitudinal: longitudinal.facts,
      wealth: wealth.facts,
      sources: (wealth.drivers ?? []) as any,
      netWorth: netWorth.net,
      confidence: String(wealth.confidence ?? ""),
      transactionsHash: historyFingerprint(txs as any),
    }).catch(() => ({ ok: false }));

    const headlineParts = [
      `Sua trajetória de ${longitudinal.facts.closed_months_analyzed} meses fechados mostra resultado ${longitudinal.facts.result_trend.direction} e consumo flexível ${longitudinal.facts.behavior_trend.direction}.`,
      `Pelo seu próprio histórico, a capacidade sustentável de poupança é ${brl(sustainable)} por mês.`,
    ];
    if (plan) {
      headlineParts.push(
        `Para ${plan.goalName}, faltam ${brl(plan.remaining)}${plan.requiredMonthly !== null ? ` e o plano pede ${brl(plan.requiredMonthly)} por mês` : " (sem prazo definido)"}.`,
      );
      if (plan.requiredMonthly !== null && plan.requiredMonthly > sustainable) {
        headlineParts.push(`Isso está acima da sua capacidade atual: ${plan.alternatives[0]?.detail ?? "vale rever prazo ou valor"}.`);
      }
      headlineParts.push(`Próximo passo: ${plan.nextAction}`);
    } else {
      headlineParts.push("Me diga o valor e o prazo do objetivo que eu fecho o plano com passos concretos.");
    }

    const env = {
      engine: "financial_plan.v1",
      facts: {
        period,
        net_worth: netWorth.net,
        net_worth_source: netWorth.formula_version,
        sustainable_monthly_saving: sustainable,
        monthly_income_normalized: monthlyIncome,
        monthly_surplus: monthlySurplus,
        trajectory: {
          closed_months_analyzed: longitudinal.facts.closed_months_analyzed,
          result_trend: longitudinal.facts.result_trend,
          behavior_trend: longitudinal.facts.behavior_trend,
          change_point: longitudinal.facts.change_point,
          open_month: longitudinal.facts.open_month,
        },
        wealth: {
          recoverable_monthly: wealth.facts.recoverable_monthly,
          scenarios: wealth.facts.scenarios,
          opportunity_gap: wealth.facts.opportunity_gap,
        },
        plan,
        assumptions: wealth.facts.assumptions,
      },
      breakdown: longitudinal.facts.closed_months,
      drivers: wealth.drivers ?? [],
      evidence: {
        ...wealth.evidence,
        formula_version: "financial_plan.v1",
      },
      confidence: wealth.confidence,
    };
    return withAnswerFormat(env as any, headlineParts.join(" "));
  });
}


// ------------------------------------------------- avaliação holística (v1)

/**
 * `assess_financial_health` (`holistic_assessment.v1`) — resposta canônica para
 * "estou melhorando ou piorando?", "como está minha vida financeira?", "faz um
 * diagnóstico geral".
 *
 * Antes, esse tipo de pergunta caía em `assess_financial_performance`, que é UMA
 * dimensão (destaques de variação) e por isso virava conclusão global a partir de
 * um único destaque. Aqui compomos as dimensões que já existem, cada uma com sua
 * própria fonte determinística. Esta função NÃO calcula dinheiro: ela apenas lê
 * números já apurados pelos motores canônicos e classifica direção e peso.
 */
type HealthDirection = "improving" | "worsening" | "stable" | "unknown";

type HealthDimension = {
  key: string;
  label: string;
  direction: HealthDirection;
  weight: number;
  fact: string;
  source: string;
};

export function assess_financial_health(
  ctx: EngineToolContext,
  args: { months?: number },
): Promise<EngineToolResult> {
  return guard(async () => {
    const today = todaySaoPaulo().slice(0, 10);
    const [perfRes, evoRes, debtRes, snap] = await Promise.all([
      assess_financial_performance(ctx, {}),
      analyze_financial_evolution(ctx, {} as Record<string, never>),
      get_debt_status(ctx, {}),
      computeAgentSnapshot(ctx.sb, ctx.user_id),
    ]);

    const evo: any = evoRes.ok ? (evoRes.result as any) : null;
    const perf: any = perfRes.ok ? (perfRes.result as any) : null;
    const debt: any = debtRes.ok ? (debtRes.result as any) : null;
    const dims: HealthDimension[] = [];

    // 1) Tendência de gasto — motor financial_evolution.
    if (evo?.facts) {
      const trend = String(evo.facts.trend ?? "");
      dims.push({
        key: "spending_trend",
        label: "Tendência de gasto",
        direction: trend === "melhorando" ? "improving" : trend === "piorando" ? "worsening" : "stable",
        weight: 3,
        fact: `Tendência de gasto ${trend || "sem leitura"} nos últimos 30 dias contra os 90 anteriores.`,
        source: evo.evidence?.formula_version ?? "financial_evolution",
      });
      const savings = evo.facts.savings_rate_30d;
      dims.push({
        key: "savings_rate",
        label: "Sobra do mês",
        direction: savings == null ? "unknown"
          : savings > 0.1 ? "improving" : savings < 0 ? "worsening" : "stable",
        weight: 3,
        fact: savings == null
          ? "Sem amostra suficiente para medir quanto sobra."
          : `Você guardou ${Math.round(Number(savings) * 100)}% do que entrou nos últimos 30 dias.`,
        source: evo.evidence?.formula_version ?? "financial_evolution",
      });
      dims.push({
        key: "stability",
        label: "Estabilidade",
        direction: String(evo.facts.stability ?? "") === "estavel" ? "improving"
          : evo.facts.stability ? "worsening" : "unknown",
        weight: 1,
        fact: `Seu gasto mensal está ${String(evo.facts.stability ?? "sem leitura")}.`,
        source: evo.evidence?.formula_version ?? "financial_evolution",
      });
    }

    // 2) Caixa projetado — snapshot canônico (nunca recalculado aqui).
    const projected = Number(snap.projected_month_end_available ?? 0);
    dims.push({
      key: "cash_position",
      label: "Caixa até o fim do mês",
      direction: projected > 0 ? "improving" : projected < 0 ? "worsening" : "stable",
      weight: 4,
      fact: `Projeção de ${brl(projected)} disponíveis no fim do mês, considerando o que já entrou, o ritmo atual e os compromissos conhecidos.`,
      source: "agent_snapshot",
    });

    // 3) Dívidas — motor debt_status.
    if (debt?.facts) {
      const overdue = Number(debt.facts.overdue_count ?? 0);
      dims.push({
        key: "debts",
        label: "Dívidas",
        direction: overdue > 0 ? "worsening" : Number(debt.facts.debts_analyzed ?? 0) === 0 ? "stable" : "improving",
        weight: 4,
        fact: overdue > 0
          ? `${overdue} dívida(s) em atraso somando ${brl(Number(debt.facts.overdue_amount ?? 0))}.`
          : Number(debt.facts.debts_analyzed ?? 0) === 0
            ? "Nenhuma dívida ativa registrada."
            : "Dívidas registradas estão em dia.",
        source: debt.evidence?.formula_version ?? "debt_status",
      });
    }

    // 4) Patrimônio — composição canônica do snapshot.
    dims.push({
      key: "net_worth",
      label: "Patrimônio",
      direction: Number(snap.net_worth ?? 0) > 0 ? "improving" : Number(snap.net_worth ?? 0) < 0 ? "worsening" : "stable",
      weight: 2,
      fact: `Patrimônio líquido de ${brl(Number(snap.net_worth ?? 0))}.`,
      source: "agent_snapshot",
    });

    // 5) Qualidade dos dados — sem isso, conclusão vira palpite.
    const mtdTxs = await loadEngineTransactions(ctx, today.slice(0, 8) + "01", today);
    const expenses = mtdTxs.filter((t: any) => t.type === "expense");
    const uncategorized = expenses.filter((t: any) => !t.category_id);
    const coverage = expenses.length > 0
      ? (expenses.length - uncategorized.length) / expenses.length
      : null;
    dims.push({
      key: "data_coverage",
      label: "Cobertura dos dados",
      direction: coverage == null ? "unknown" : coverage >= 0.9 ? "improving" : coverage >= 0.6 ? "stable" : "worsening",
      weight: 1,
      fact: coverage == null
        ? "Nenhuma despesa registrada neste mês."
        : `${uncategorized.length} de ${expenses.length} despesas do mês ainda estão sem categoria.`,
      source: "transactions",
    });

    const known = dims.filter((d) => d.direction !== "unknown");
    const score = known.reduce((acc, d) =>
      acc + (d.direction === "improving" ? d.weight : d.direction === "worsening" ? -d.weight : 0), 0);
    const totalWeight = known.reduce((acc, d) => acc + d.weight, 0) || 1;
    const verdict: "improving" | "worsening" | "mixed" | "insufficient" = known.length < 3
      ? "insufficient"
      : score >= Math.round(totalWeight * 0.25) ? "improving"
      : score <= -Math.round(totalWeight * 0.25) ? "worsening"
      : "mixed";

    const strengths = known.filter((d) => d.direction === "improving")
      .sort((a, b) => b.weight - a.weight).slice(0, 3);
    const risks = known.filter((d) => d.direction === "worsening")
      .sort((a, b) => b.weight - a.weight).slice(0, 3);

    const conclusion = verdict === "insufficient"
      ? "Ainda não tenho base suficiente para dizer se você está melhorando ou piorando."
      : verdict === "improving"
        ? "No conjunto, você está melhorando."
        : verdict === "worsening"
          ? "No conjunto, você está piorando."
          : "No conjunto, o quadro está misto: tem avanço em uma parte e pressão em outra.";

    const highlight = perf?.facts?.main_attention ?? perf?.facts?.main_improvement ?? null;

    return {
      engine: "holistic_assessment.v1",
      facts: {
        verdict,
        conclusion,
        dimensions_considered: dims.length,
        dimensions_measured: known.length,
        strengths: strengths.map((d) => ({ key: d.key, label: d.label, fact: d.fact })),
        risks: risks.map((d) => ({ key: d.key, label: d.label, fact: d.fact })),
        next_action: perf?.facts?.next_action ?? null,
        period_highlight: highlight,
      },
      breakdown: dims,
      drivers: risks,
      evidence: {
        formula_version: "holistic_assessment.v1",
        period: { from: today.slice(0, 8) + "01", to: today },
        sample_size: expenses.length,
        notes: [
          "Cada dimensão vem do seu próprio motor canônico; esta camada só classifica direção e peso.",
          "Nenhum valor é recalculado aqui.",
        ],
      },
      confidence: known.length >= 5 ? "high" : known.length >= 3 ? "medium" : "low",
      answer_format: {
        version: "nino_answer_format.v1",
        headline: conclusion,
        delta_line: risks[0]?.fact ?? strengths[0]?.fact ?? null,
        evidence_line: `Leitura baseada em ${known.length} dimensões da sua vida financeira.`,
        confidence_label: known.length >= 5 ? "alta" : known.length >= 3 ? "média" : "baixa",
      },
    };
  });
}
