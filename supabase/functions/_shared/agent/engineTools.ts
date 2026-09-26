// Fachada semântica dos engine tools.
// Mantém a implementação original isolada e corrige linguagem/escopo sem
// duplicar os motores de verdade financeira.
// deno-lint-ignore-file no-explicit-any
import * as legacy from "./engineToolsImpl.ts";
import { merchantProfile } from "../finance-core/merchantIntelligence.ts";
import { previousWindow, type EnginePeriod } from "../finance-core/engineEnvelope.ts";
import { today, shift } from "../finance-core/ninoClock.ts";
import { withAnswerFormat, brl } from "./answerFormat.ts";
import type { MerchantAliasRow } from "../finance-core/merchant.ts";

export * from "./engineToolsImpl.ts";

export async function analyze_financial_evolution(
  ...args: Parameters<typeof legacy.analyze_financial_evolution>
): Promise<Awaited<ReturnType<typeof legacy.analyze_financial_evolution>>> {
  const execution = await legacy.analyze_financial_evolution(...args);
  if (!execution.ok) return execution;

  const result = execution.result as any;
  const headline = String(result?.answer_format?.headline ?? "")
    .replace("entraram ", "as receitas da rotina somaram ")
    .replace(" e saíram ", " e os gastos da rotina somaram ")
    .replace("(resultado ", "(resultado operacional ");

  return {
    ok: true,
    result: {
      ...result,
      answer_format: {
        ...(result?.answer_format ?? {}),
        headline,
      },
    },
  };
}

const SCOPED_MERCHANT_TX_SELECT = [
  "id", "account_id", "category_id", "type", "status", "amount", "occurred_at",
  "description", "raw_description", "normalized_description", "bank_description",
  "friendly_description", "merchant_name", "transfer_group_id", "payment_method",
  "credit_card_id", "settles_card_id", "movement_kind", "posted_at", "posted_at_source",
  "competence_date", "investment_id", "refund_of_transaction_id",
].join(",");

function scopedPeriod(args: { from?: string; to?: string; days?: number }): EnginePeriod {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(args?.from ?? "").slice(0, 10);
  const to = String(args?.to ?? "").slice(0, 10);
  const end = ymd.test(to) ? to : today();
  if (ymd.test(from) && from <= end) return { from, to: end };
  const days = Math.max(1, Math.min(730, Math.round(Number(args?.days ?? 90))));
  return { from: shift(end, -(days - 1)), to: end };
}

async function scopedCategoryId(ctx: any, categoryName: string): Promise<string | null> {
  const wanted = String(categoryName ?? "").trim();
  if (!wanted) return null;
  const { data, error } = await ctx.sb.from("categories")
    .select("id,name")
    .or(`user_id.eq.${ctx.user_id},user_id.is.null`)
    .is("archived_at", null);
  if (error) throw new Error(`categories_query_failed:${error.message}`);
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const target = norm(wanted);
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  return rows.find((r) => norm(r.name) === target)?.id
    ?? rows.find((r) => norm(r.name).startsWith(target) || target.startsWith(norm(r.name)))?.id
    ?? null;
}

async function scopedAliases(ctx: any): Promise<MerchantAliasRow[]> {
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

async function scopedTransactions(ctx: any, from: string, to: string): Promise<any[]> {
  const rows: any[] = [];
  const pageSize = 1_000;
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const { data, error } = await ctx.sb.from("transactions")
      .select(SCOPED_MERCHANT_TX_SELECT)
      .eq("user_id", ctx.user_id)
      .gte("occurred_at", from)
      .lte("occurred_at", to)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`transactions_query_failed:${error.message}`);
    const page = (data ?? []) as any[];
    rows.push(...page.map((r) => ({ ...r, amount: Number(r.amount) })));
    if (page.length < pageSize) return rows;
  }
  throw new Error("transactions_query_exceeded_100000_rows");
}

/**
 * Perfil canônico de estabelecimento com escopo opcional de categoria.
 * Sem categoria delega ao wrapper legado; com categoria usa o MESMO motor puro
 * merchantProfile, mas resolve a categoria antes de executar. Assim uma pergunta
 * "quanto gastei em Lazer no estabelecimento X" nunca soma X em outras categorias.
 */
export async function merchant_profile(
  ctx: Parameters<typeof legacy.merchant_profile>[0],
  args: Parameters<typeof legacy.merchant_profile>[1] & { category_id?: string; category_name?: string },
): Promise<Awaited<ReturnType<typeof legacy.merchant_profile>>> {
  const categoryName = String(args?.category_name ?? "").trim();
  const explicitCategoryId = String(args?.category_id ?? "").trim();
  if (!categoryName && !explicitCategoryId) return await legacy.merchant_profile(ctx, args);

  try {
    const period = scopedPeriod(args ?? {});
    const comparisonPeriod = previousWindow(period);
    const categoryId = explicitCategoryId || await scopedCategoryId(ctx, categoryName);
    if (!categoryId) return { ok: false, error: "category_not_found" };
    const [txs, aliases] = await Promise.all([
      scopedTransactions(ctx, comparisonPeriod.from, period.to),
      scopedAliases(ctx),
    ]);
    const env = merchantProfile({
      txs: txs as any,
      period,
      comparisonPeriod,
      aliases,
      categoryId,
      query: String(args?.query ?? ""),
    });
    const f = env.facts;
    const scopeLabel = categoryName ? ` em ${categoryName}` : "";
    const headline = f.found
      ? `${f.label}${scopeLabel}: ${brl(f.net_total)} em ${f.count} compra(s), ticket médio ${brl(f.avg_ticket)}.`
      : `Não encontrei lançamentos de “${f.query}”${scopeLabel} nessa janela.`;
    return withAnswerFormat(
      { ...env, facts: { ...f, category_id: categoryId, category_name: categoryName || null } },
      headline,
      f.delta_abs,
    ) as Awaited<ReturnType<typeof legacy.merchant_profile>>;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
