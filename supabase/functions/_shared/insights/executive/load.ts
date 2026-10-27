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
import type { AnticipatedInstallment, ExecutiveInput, LedgerEntry } from "./engine.ts";

const TX_COLUMNS = [
  "id", "account_id", "category_id", "type", "status", "amount", "occurred_at",
  "description", "transfer_group_id", "payment_method", "credit_card_id",
  "settles_card_id", "movement_kind", "posted_at", "competence_date", "economic_competence_date", "installment_anticipated", "refund_of_transaction_id",
  "purchase_date", "purchase_group_id", "installment_number", "installments_total",
].join(",");

const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

/**
 * Dia do gráfico diário/semanal. Cartão: dia da compra quando ela é do mesmo mês da
 * competência; compra de mês anterior (parcela antiga, borda do ciclo) vai para o dia
 * de fechamento da fatura. Nunca o dia 1: o dia 1 acumulava o cartão inteiro do mês.
 */
export function chartDateOf(row: any, closingDay: number | null): string | null {
  const isCard = Boolean(row.credit_card_id) || String(row.payment_method ?? "") === "credit_card";
  if (!isCard) return null;
  const comp = reportingCompetenceDate(row as TransactionRow);
  const purchase = String(row.purchase_date ?? row.occurred_at ?? "").slice(0, 10);
  if (purchase.length === 10 && purchase.slice(0, 7) === comp.slice(0, 7)) return purchase;
  const ym = comp.slice(0, 7);
  const day = Math.min(Math.max(1, closingDay ?? lastDay(ym)), lastDay(ym));
  return `${ym}-${String(day).padStart(2, "0")}`;
}

/** Parcelas antecipadas do livro: cobradas numa fatura, vencendo em outro mês. */
export function collectAnticipations(rows: any[]): AnticipatedInstallment[] {
  const out: AnticipatedInstallment[] = [];
  for (const r of rows) {
    if (!r.installment_anticipated || String(r.status ?? "") !== "confirmed" || r.type !== "expense") continue;
    const amount = Number(r.amount ?? 0);
    const billed = String(r.competence_date ?? "").slice(0, 7);
    const economic = String(r.economic_competence_date ?? r.competence_date ?? "").slice(0, 7);
    if (!(amount > 0) || billed.length !== 7) continue;
    out.push({ billed_month: billed, economic_month: economic, amount, group: String(r.purchase_group_id ?? r.id) });
  }
  return out;
}

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
  opts: { includeDebtPayments?: boolean; closingDays?: Map<string, number> } = {},
): LedgerEntry[] {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const attribution = buildRefundAttribution(rows as TransactionRow[]);
  const resolver = buildMerchantResolver(aliases);
  const out: LedgerEntry[] = [];
  for (const raw of rows) {
    const row = { ...raw, amount: Number(raw.amount ?? 0) } as TransactionRow;
    const date = reportingCompetenceDate(row);
    if (date < window.from || date > window.to) continue;
    // Relatórios mostram para onde o dinheiro saiu: parcela de empréstimo e
    // pagamento de dívida são saída real da conta (os insights executivos seguem
    // tratando como amortização, não como gasto novo).
    const debtOut = opts.includeDebtPayments === true
      && (row.movement_kind === "debt_payment" || row.movement_kind === "loan_payment")
      && row.type === "expense" && !row.transfer_group_id && !row.settles_card_id;
    const expense = debtOut ? Number(row.amount || 0) : behavioralMetricAmount(row, "expense");
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
      chart_date: kind === "expense"
        ? chartDateOf(row, row.credit_card_id ? opts.closingDays?.get(String(row.credit_card_id)) ?? null : null)
        : null,
    });
  }
  return out;
}

export async function loadExecutiveInput(sb: any, userId: string, asOf: string, monthsBack = 12, opts: { includeDebtPayments?: boolean } = {}): Promise<ExecutiveInput> {
  const to = `${asOf.slice(0, 7)}-31`;
  const from = (() => {
    const d = new Date(`${asOf.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - monthsBack);
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

  const [{ data: cats }, { data: aliasRows }, { data: installments }, { data: cardRows }] = await Promise.all([
    sb.from("categories").select("id,name").or(`user_id.eq.${userId},user_id.is.null`),
    sb.from("merchant_aliases").select("alias_key,friendly_name,hits").eq("user_id", userId),
    sb.from("credit_card_installments")
      .select("competence_month,amount,status,absorbed_by_statement_id")
      .eq("user_id", userId)
      .gt("competence_month", `${asOf.slice(0, 7)}-01`),
    sb.from("credit_cards").select("id,closing_day").eq("user_id", userId),
  ]);
  const closingDays = new Map<string, number>(((cardRows ?? []) as any[])
    .filter((c) => Number(c.closing_day) > 0).map((c) => [String(c.id), Number(c.closing_day)]));
  const categories = new Map<string, string>(((cats ?? []) as any[]).map((c) => [String(c.id), String(c.name)]));
  const aliases: MerchantAliasRow[] = ((aliasRows ?? []) as any[]).map((a) => ({
    alias_normalized: a.alias_key,
    canonical_name: a.friendly_name,
    confidence: Math.min(1, 0.5 + Number(a.hits ?? 1) / 20),
  }));
  return {
    as_of: asOf,
    entries: toLedger(rows, categories, aliases, { from, to }, { ...opts, closingDays }),
    anticipations: collectAnticipations(rows),
    future_installments: ((installments ?? []) as any[])
      .filter((row) => String(row.status ?? "") !== "paid" && !row.absorbed_by_statement_id)
      .map((row) => ({ month: String(row.competence_month ?? "").slice(0, 7), amount: Number(row.amount ?? 0) }))
      .filter((row) => /^\d{4}-\d{2}$/.test(row.month) && row.amount > 0),
  };
}
