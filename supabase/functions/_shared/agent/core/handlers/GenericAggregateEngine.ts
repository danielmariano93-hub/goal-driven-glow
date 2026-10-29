// GenericAggregateEngine (`nino_generic_aggregate.v1`)
// Carrega os fatos do usuário e roda o núcleo puro `aggregate`. É a ÚNICA porta
// de entrada de combinações filtro × dimensão que não têm motor dedicado.
// Mesma leitura paginada, mesma janela de competência e mesmos estornos do
// coletor das séries (`collectScopedSpend`).
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../../../derived/pagedSelect.ts";
import type { TransactionRow } from "../../../finance-core/facts.ts";
import {
  aggregate, AGG_DIMENSIONS, MAX_AGG_DIMENSIONS, type AggDimension, type AggResult,
} from "./GenericAggregate.ts";
import { loadAliases, loadReferencedOriginals, TX_COLUMNS } from "./MonthlySeriesHandler.ts";
import { resolveCategoryIdsByName } from "./TypicalMonthlyHandler.ts";

export const SPENDING_AGGREGATE_ENGINE = "spending_aggregate";

export type SpendingAggregateArgs = {
  metric?: "expense" | "income";
  from: string;
  to: string;
  group_by?: string[];
  category?: string | null;
  merchant?: string | null;
  card?: string | null;
  account?: string | null;
  payment_method?: string | null;
  limit?: number | null;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Casa um nome falado com um registro do usuário: exato primeiro, depois contido. */
function resolveByName(rows: Array<{ id: string; name: string }>, wanted: string): { ids: string[]; labels: string[] } {
  const target = norm(wanted);
  const exact = rows.filter((r) => norm(r.name) === target);
  const hit = exact.length ? exact : rows.filter((r) => norm(r.name).includes(target) || target.includes(norm(r.name)));
  return { ids: hit.map((r) => r.id), labels: hit.map((r) => r.name) };
}

export type SpendingAggregateResult = AggResult & {
  engine: typeof SPENDING_AGGREGATE_ENGINE;
  /** Mesma janela de `window`, no nome que a evidência do gate procura. */
  period: { from: string; to: string };
  scope_labels: { category: string | null; card: string | null; account: string | null };
  headline: string;
  executed_ir: Record<string, unknown>;
};

export async function runSpendingAggregate(
  sb: any,
  user_id: string,
  args: SpendingAggregateArgs,
): Promise<SpendingAggregateResult> {
  const metric = args.metric === "income" ? "income" : "expense";
  const groupBy = (args.group_by ?? []).filter((g): g is AggDimension =>
    (AGG_DIMENSIONS as readonly string[]).includes(g)).slice(0, MAX_AGG_DIMENSIONS);
  if ((args.group_by ?? []).length !== groupBy.length) throw new Error("spending_aggregate_dimension_unsupported");

  const [cards, accounts, categories] = await Promise.all([
    sb.from("credit_cards").select("id,name").eq("user_id", user_id),
    sb.from("accounts").select("id,name").eq("user_id", user_id),
    sb.from("categories").select("id,name").or(`user_id.eq.${user_id},user_id.is.null`),
  ]);
  const cardRows = ((cards.data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));
  const accountRows = ((accounts.data ?? []) as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));
  const lookups = {
    categories: new Map(((categories.data ?? []) as any[]).map((r) => [String(r.id), String(r.name ?? "")])),
    cards: new Map(cardRows.map((r) => [r.id, r.name])),
    accounts: new Map(accountRows.map((r) => [r.id, r.name])),
  };

  // Filtro pedido e não resolvido NUNCA é descartado: vira erro de domínio.
  let categoryIds: string[] | null = null;
  let categoryLabel: string | null = null;
  if (args.category) {
    categoryIds = await resolveCategoryIdsByName(sb, user_id, args.category);
    if (!categoryIds.length) throw new Error("category_not_found");
    if (categoryIds.length > 1) throw new Error("category_not_found:ambiguous");
    categoryLabel = lookups.categories.get(categoryIds[0]) ?? args.category;
  }
  let cardIds: string[] | null = null;
  let cardLabel: string | null = null;
  if (args.card) {
    const r = resolveByName(cardRows, args.card);
    if (!r.ids.length) throw new Error("card_not_found");
    if (r.ids.length > 1) throw new Error("card_not_found:ambiguous");
    cardIds = r.ids; cardLabel = r.labels[0];
  }
  let accountIds: string[] | null = null;
  let accountLabel: string | null = null;
  if (args.account) {
    const r = resolveByName(accountRows, args.account);
    if (!r.ids.length) throw new Error("account_not_found");
    if (r.ids.length > 1) throw new Error("account_not_found:ambiguous");
    accountIds = r.ids; accountLabel = r.labels[0];
  }

  const rows = await fetchAllPages<any>((from, to) =>
    sb.from("transactions").select(TX_COLUMNS)
      .eq("user_id", user_id)
      .eq("status", "confirmed")
      .gte("occurred_at", shiftDays(args.from, -45))
      .lte("occurred_at", shiftDays(args.to, 45))
      .order("occurred_at", { ascending: true })
      .range(from, to),
  { source: "spending_aggregate" });
  const [aliases, referenced] = await Promise.all([
    loadAliases(sb, user_id),
    loadReferencedOriginals(sb, user_id, rows),
  ]);

  const result = aggregate({
    metric,
    rows: rows as TransactionRow[],
    referenced: referenced as TransactionRow[],
    aliases,
    lookups,
    from: args.from,
    to: args.to,
    group_by: groupBy,
    limit: args.limit ?? null,
    scope: {
      category_ids: categoryIds,
      merchant: args.merchant ?? null,
      card_ids: cardIds,
      account_ids: accountIds,
      payment_method: args.payment_method ?? null,
    },
  });

  // Filtros e dimensões REALMENTE aplicados, nos mesmos nomes do pedido: é o
  // que a checagem pedido-vs-executado compara.
  const filters: Array<{ field: string; op: "eq"; value: string }> = [];
  if (categoryLabel) filters.push({ field: "category", op: "eq", value: categoryLabel });
  if (result.scope.merchant) filters.push({ field: "merchant", op: "eq", value: result.scope.merchant });
  if (cardLabel) filters.push({ field: "card", op: "eq", value: cardLabel });
  if (accountLabel) filters.push({ field: "account", op: "eq", value: accountLabel });
  if (result.scope.payment_method) filters.push({ field: "payment_method", op: "eq", value: result.scope.payment_method });

  return {
    ...result,
    engine: SPENDING_AGGREGATE_ENGINE,
    period: { from: args.from, to: args.to },
    scope_labels: { category: categoryLabel, card: cardLabel, account: accountLabel },
    headline: "",
    executed_ir: {
      metric: metric === "income" ? "income_amount" : "expense_amount",
      filters,
      time: { aspect: "value", from: args.from, to: args.to, n: null, exclude_partial: false },
      grain: "none",
      reduce: "sum",
      group_by: result.group_by,
      partial: false,
    },
  };
}
