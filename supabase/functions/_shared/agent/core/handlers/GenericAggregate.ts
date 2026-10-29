// GenericAggregate (`nino_generic_aggregate.v1`)
// Núcleo PURO do executor genérico de gasto/receita: filtros combináveis
// (categoria, estabelecimento, cartão, conta, forma de pagamento) e até duas
// dimensões de agrupamento, sobre as mesmas regras contábeis do restante do
// Nino (competência, estorno atribuído à categoria/estabelecimento original,
// alias de estabelecimento, antecipação de parcela). Não lê banco nem chama
// modelo: recebe as linhas já carregadas e devolve números.
//
// Por quê: cada combinação nova (estabelecimento × categoria, estabelecimento
// por cartão, dia da semana...) exigia um `if` e um motor próprios no adaptador.
// Aqui a combinação é dado, não código.
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  reportingCompetenceDate,
  round2,
  type TransactionRow,
} from "../../../finance-core/facts.ts";
import {
  buildMerchantResolver,
  merchantMatches,
  type MerchantAliasRow,
} from "../../../finance-core/merchant.ts";

export const GENERIC_AGGREGATE_VERSION = "nino_generic_aggregate.v1";
export const GENERIC_AGGREGATE_FORMULA_VERSION = "generic_aggregate.v1";

export const AGG_DIMENSIONS = [
  "category", "merchant", "card", "account", "payment_method",
  "month", "week", "day", "quarter", "weekday",
] as const;
export type AggDimension = typeof AGG_DIMENSIONS[number];

const TIME_DIMENSIONS = new Set<AggDimension>(["month", "week", "day", "quarter"]);
export const MAX_AGG_DIMENSIONS = 2;

export type AggScope = {
  category_ids?: string[] | null;
  merchant?: string | null;
  card_ids?: string[] | null;
  account_ids?: string[] | null;
  payment_method?: string | null;
};

export type AggLookups = {
  categories: Map<string, string>;
  cards: Map<string, string>;
  accounts: Map<string, string>;
};

export type AggInput = {
  metric: "expense" | "income";
  rows: TransactionRow[];
  /** Originais de estornos que ficaram fora da janela carregada. */
  referenced?: TransactionRow[];
  aliases?: MerchantAliasRow[];
  lookups: AggLookups;
  from: string;
  to: string;
  scope?: AggScope;
  group_by?: AggDimension[];
  /** Maior valor primeiro (padrão para dimensões categóricas). */
  limit?: number | null;
};

export type AggGroup = {
  key: Record<string, string>;
  label: string;
  total: number;
  transaction_count: number;
  share: number | null;
};

export type AggResult = {
  version: typeof GENERIC_AGGREGATE_VERSION;
  formula_version: typeof GENERIC_AGGREGATE_FORMULA_VERSION;
  metric: "expense" | "income";
  window: { from: string; to: string };
  group_by: AggDimension[];
  scope: {
    category_ids: string[]; merchant: string | null;
    card_ids: string[]; account_ids: string[]; payment_method: string | null;
  };
  groups: AggGroup[];
  total: number;
  transaction_count: number;
  /** Quando `limit` corta a lista, o que ficou de fora continua contado. */
  omitted: { groups: number; total: number };
};

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function ymdParts(ymd: string): { y: number; m: number; d: number } {
  return { y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)), d: Number(ymd.slice(8, 10)) };
}

function weekdayIndex(ymd: string): number {
  const { y, m, d } = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function weekStartMonday(ymd: string): string {
  const { y, m, d } = ymdParts(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const back = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

function quarterKey(ymd: string): string {
  const { y, m } = ymdParts(ymd);
  return `${y}-T${Math.floor((m - 1) / 3) + 1}`;
}

export function isTimeDimension(dim: AggDimension): boolean {
  return TIME_DIMENSIONS.has(dim);
}

/** Valor de uma dimensão para a linha; `null` quando a linha não tem valor. */
function dimensionValue(
  dim: AggDimension,
  row: TransactionRow,
  ctx: {
    competence: string;
    categoryId: string | null;
    merchantLabel: string | null;
    lookups: AggLookups;
  },
): { key: string; label: string } {
  switch (dim) {
    case "category": {
      const id = ctx.categoryId;
      return id
        ? { key: id, label: ctx.lookups.categories.get(id) ?? "Categoria sem nome" }
        : { key: "none", label: "Sem categoria" };
    }
    case "merchant":
      return ctx.merchantLabel
        ? { key: ctx.merchantLabel.toLowerCase(), label: ctx.merchantLabel }
        : { key: "none", label: "Sem estabelecimento" };
    case "card": {
      const id = row.credit_card_id ? String(row.credit_card_id) : null;
      return id
        ? { key: id, label: ctx.lookups.cards.get(id) ?? "Cartão" }
        : { key: "none", label: "Sem cartão" };
    }
    case "account": {
      const id = row.account_id ? String(row.account_id) : null;
      return id
        ? { key: id, label: ctx.lookups.accounts.get(id) ?? "Conta" }
        : { key: "none", label: "Sem conta" };
    }
    case "payment_method": {
      const pm = String(row.payment_method ?? "") || "none";
      const label = pm === "credit_card" ? "Cartão de crédito" : pm === "account" ? "Conta" : pm === "none" ? "Sem forma" : pm;
      return { key: pm, label };
    }
    case "month": {
      const k = ctx.competence.slice(0, 7);
      return { key: k, label: k };
    }
    case "week": {
      const k = weekStartMonday(ctx.competence);
      return { key: k, label: `semana de ${k.slice(8, 10)}/${k.slice(5, 7)}` };
    }
    case "day":
      return { key: ctx.competence.slice(0, 10), label: ctx.competence.slice(0, 10) };
    case "quarter": {
      const k = quarterKey(ctx.competence);
      return { key: k, label: k };
    }
    case "weekday": {
      const i = weekdayIndex(ctx.competence);
      return { key: String(i), label: WEEKDAYS[i] };
    }
  }
}

export function aggregate(input: AggInput): AggResult {
  const groupBy = (input.group_by ?? []).slice(0, MAX_AGG_DIMENSIONS);
  const scope = input.scope ?? {};
  const universe = [...input.rows, ...(input.referenced ?? [])];
  const byId = new Map(universe.map((r) => [String(r.id), r]));
  const attribution = buildRefundAttribution(universe);
  const resolver = buildMerchantResolver(input.aliases ?? []);
  const categorySet = scope.category_ids?.length ? new Set(scope.category_ids.map(String)) : null;
  const cardSet = scope.card_ids?.length ? new Set(scope.card_ids.map(String)) : null;
  const accountSet = scope.account_ids?.length ? new Set(scope.account_ids.map(String)) : null;
  const merchantQuery = String(scope.merchant ?? "").trim() || null;
  const needsMerchant = !!merchantQuery || groupBy.includes("merchant");

  const buckets = new Map<string, AggGroup & { order: string }>();
  let total = 0;
  let count = 0;

  for (const raw of input.rows) {
    const row = { ...raw, amount: Number(raw.amount ?? 0) } as TransactionRow;
    const competence = reportingCompetenceDate(row);
    if (competence < input.from || competence > input.to) continue;
    const amount = behavioralMetricAmount(row, input.metric);
    if (amount === 0) continue;

    const categoryId = effectiveCategoryId(row, attribution);
    if (categorySet && (!categoryId || !categorySet.has(String(categoryId)))) continue;
    if (cardSet && !(row.credit_card_id && cardSet.has(String(row.credit_card_id)))) continue;
    if (accountSet && !(row.account_id && accountSet.has(String(row.account_id)))) continue;
    if (scope.payment_method && String(row.payment_method ?? "") !== scope.payment_method) continue;

    let merchantLabel: string | null = null;
    if (needsMerchant) {
      const original = row.refund_of_transaction_id
        ? (byId.get(String(row.refund_of_transaction_id)) as TransactionRow | undefined)
        : undefined;
      const source = original ?? row;
      const resolved = resolver.resolve(source.description ?? null);
      if (merchantQuery && (!resolved || !merchantMatches(resolved.key, resolved.label, merchantQuery))) continue;
      merchantLabel = resolved?.label ?? null;
    }

    const parts = groupBy.map((dim) => dimensionValue(dim, row, { competence, categoryId, merchantLabel, lookups: input.lookups }));
    const bucketKey = parts.map((p) => p.key).join("|");
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        key: Object.fromEntries(groupBy.map((dim, i) => [dim, parts[i].label])),
        label: parts.map((p) => p.label).join(" · ") || "Total",
        total: 0, transaction_count: 0, share: null,
        order: parts.map((p) => p.key).join("|"),
      };
      buckets.set(bucketKey, bucket);
    }
    bucket.total = round2(bucket.total + amount);
    bucket.transaction_count += 1;
    total = round2(total + amount);
    count += 1;
  }

  const timeFirst = groupBy.length > 0 && groupBy.every((d) => isTimeDimension(d) || d === "weekday");
  const ordered = [...buckets.values()].sort((a, b) =>
    timeFirst
      ? a.order.localeCompare(b.order, "pt-BR", { numeric: true })
      : b.total - a.total || a.label.localeCompare(b.label, "pt-BR")
  );
  const limit = input.limit && input.limit > 0 ? input.limit : null;
  const kept = limit ? ordered.slice(0, limit) : ordered;
  const omitted = limit ? ordered.slice(limit) : [];

  return {
    version: GENERIC_AGGREGATE_VERSION,
    formula_version: GENERIC_AGGREGATE_FORMULA_VERSION,
    metric: input.metric,
    window: { from: input.from, to: input.to },
    group_by: groupBy,
    scope: {
      category_ids: scope.category_ids?.map(String) ?? [],
      merchant: merchantQuery,
      card_ids: scope.card_ids?.map(String) ?? [],
      account_ids: scope.account_ids?.map(String) ?? [],
      payment_method: scope.payment_method ?? null,
    },
    groups: kept.map(({ order: _order, ...g }) => ({
      ...g,
      share: total > 0 ? Math.round((g.total / total) * 1000) / 10 : null,
    })),
    total,
    transaction_count: count,
    omitted: { groups: omitted.length, total: round2(omitted.reduce((s, g) => s + g.total, 0)) },
  };
}
