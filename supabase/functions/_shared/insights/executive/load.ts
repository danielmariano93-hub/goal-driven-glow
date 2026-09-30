// Carga do livro canônico para os insights executivos.
// Mesma verdade de Home, relatórios e Nino (finance-core): competência de
// relatório, estorno abatendo a despesa original (categoria e estabelecimento),
// transferências/fatura/investimentos fora do consumo.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../../derived/pagedSelect.ts";
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  reportingCompetenceDate,
  type TransactionRow,
} from "../../finance-core/facts.ts";
import { buildMerchantResolver, type MerchantAliasRow } from "../../finance-core/merchant.ts";
import type { ExecutiveInput, LedgerEntry } from "./engine.ts";

const TX_COLUMNS = [
  "id", "account_id", "category_id", "type", "status", "amount", "occurred_at",
  "description", "transfer_group_id", "payment_method", "credit_card_id",
  "settles_card_id", "movement_kind", "posted_at", "competence_date", "refund_of_transaction_id",
].join(",");

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Converte linhas brutas no livro canônico (puro, exportado para teste). */
export function toLedger(
  rows: any[],
  categories: Map<string, string>,
  aliases: MerchantAliasRow[],
  window: { from: string; to: string },
): LedgerEntry[] {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const attribution = buildRefundAttribution(rows as TransactionRow[]);
  const resolver = buildMerchantResolver(aliases);
  const out: LedgerEntry[] = [];
  for (const raw of rows) {
    const row = { ...raw, amount: Number(raw.amount ?? 0) } as TransactionRow;
    const date = reportingCompetenceDate(row);
    if (date < window.from || date > window.to) continue;
    const expense = behavioralMetricAmount(row, "expense");
    const income = behavioralMetricAmount(row, "income");
    if (expense === 0 && income === 0) continue;
    const kind: LedgerEntry["kind"] = expense !== 0 ? "expense" : "income";
    const original = row.refund_of_transaction_id ? byId.get(String(row.refund_of_transaction_id)) : undefined;
    const categoryId = kind === "expense" ? effectiveCategoryId(row, attribution) : row.category_id ?? null;
    const merchant = kind === "expense" ? resolver.resolve((original ?? row).description ?? null) : null;
    out.push({
      id: String(row.id),
      date,
      kind,
      amount: kind === "expense" ? expense : income,
      category_id: categoryId,
      category: (categoryId && categories.get(String(categoryId))) || "Sem categoria",
      merchant_key: merchant?.key ?? null,
      merchant: merchant?.label ?? null,
    });
  }
  return out;
}

export async function loadExecutiveInput(sb: any, userId: string, asOf: string): Promise<ExecutiveInput> {
  const to = `${asOf.slice(0, 7)}-31`;
  const from = (() => {
    const d = new Date(`${asOf.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 12);
    return d.toISOString().slice(0, 10);
  })();
  // Compras no cartão podem ter competência meses depois da data da compra.
  const rows = await fetchAllPages<any>((a, b) =>
    sb.from("transactions").select(TX_COLUMNS)
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .gte("occurred_at", shiftDays(from, -200))
      .lte("occurred_at", shiftDays(asOf, 1))
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b),
  { source: "executive_insights" });

  const [{ data: cats }, { data: aliasRows }, { data: installments }] = await Promise.all([
    sb.from("categories").select("id,name").or(`user_id.eq.${userId},user_id.is.null`),
    sb.from("merchant_aliases").select("alias_key,friendly_name,hits").eq("user_id", userId),
    sb.from("credit_card_installments")
      .select("competence_month,amount,status,absorbed_by_statement_id")
      .eq("user_id", userId)
      .gt("competence_month", `${asOf.slice(0, 7)}-01`),
  ]);
  const categories = new Map<string, string>(((cats ?? []) as any[]).map((c) => [String(c.id), String(c.name)]));
  const aliases: MerchantAliasRow[] = ((aliasRows ?? []) as any[]).map((a) => ({
    alias_normalized: a.alias_key,
    canonical_name: a.friendly_name,
    confidence: Math.min(1, 0.5 + Number(a.hits ?? 1) / 20),
  }));
  return {
    as_of: asOf,
    entries: toLedger(rows, categories, aliases, { from, to }),
    future_installments: ((installments ?? []) as any[])
      .filter((row) => String(row.status ?? "") !== "paid" && !row.absorbed_by_statement_id)
      .map((row) => ({ month: String(row.competence_month ?? "").slice(0, 7), amount: Number(row.amount ?? 0) }))
      .filter((row) => /^\d{4}-\d{2}$/.test(row.month) && row.amount > 0),
  };
}
