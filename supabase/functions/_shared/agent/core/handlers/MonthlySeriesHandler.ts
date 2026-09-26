// MonthlySeriesHandler (`nino_monthly_series.v1`)
// Deterministic month-by-month spending read. It preserves category + merchant
// filters, reporting competence, refunds and merchant identity. The LLM never
// calculates the monthly values; it only receives these audited facts.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../../../derived/pagedSelect.ts";
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
import type { FinancialQueryV3 } from "../FinancialIRv3.ts";
import type { ExecutedIR } from "../SemanticPreservation.ts";
import { monthsInWindow } from "./TypicalMonthlyHandler.ts";

const TX_COLUMNS = [
  "id", "account_id", "category_id", "type", "status", "amount", "occurred_at",
  "description", "transfer_group_id", "payment_method", "credit_card_id",
  "settles_card_id", "movement_kind", "posted_at", "posted_at_source",
  "competence_date", "investment_id", "refund_of_transaction_id",
].join(",");

export const MONTHLY_SERIES_FORMULA_VERSION = "monthly_spending_series.v1";

export type MonthlySeriesPoint = {
  month: string;
  total: number;
  has_data: boolean;
  transaction_count: number;
};

export type MonthlySpendingSeriesResult = {
  version: "nino_monthly_series.v1";
  formula_version: typeof MONTHLY_SERIES_FORMULA_VERSION;
  months: MonthlySeriesPoint[];
  total: number;
  transaction_count: number;
  window: { from: string; to: string; n: number };
  scope: { category: string | null; merchant: string | null };
  partial_first_month: boolean;
  partial_last_month: boolean;
};

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(ymd: string): string {
  const [year, month] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

async function loadAliases(sb: any, userId: string): Promise<MerchantAliasRow[]> {
  const { data, error } = await sb.from("merchant_aliases")
    .select("alias_key,friendly_name,hits")
    .eq("user_id", userId);
  if (error) return [];
  return (data ?? []).map((a: any) => ({
    alias_normalized: a.alias_key,
    canonical_name: a.friendly_name,
    confidence: Math.min(1, 0.5 + Number(a.hits ?? 1) / 20),
  }));
}

async function loadReferencedOriginals(sb: any, userId: string, rows: any[]): Promise<any[]> {
  const present = new Set(rows.map((row) => String(row.id)));
  const missing = [...new Set(rows
    .map((row) => String(row.refund_of_transaction_id ?? ""))
    .filter((id) => id && !present.has(id)))];
  const out: any[] = [];
  for (let offset = 0; offset < missing.length; offset += 200) {
    const ids = missing.slice(offset, offset + 200);
    const { data, error } = await sb.from("transactions").select(TX_COLUMNS)
      .eq("user_id", userId).in("id", ids);
    if (!error && data?.length) out.push(...data);
  }
  return out;
}

/**
 * One paginated read for the requested window (+ competence padding), then
 * deterministic bucketing. Refund originals are fetched only when necessary so
 * a September refund can still be attributed to an August merchant/category.
 */
export async function loadMonthlySpendingSeries(
  sb: any,
  args: {
    user_id: string;
    from: string;
    to: string;
    category_ids?: string[] | null;
    category_label?: string | null;
    merchant?: string | null;
  },
): Promise<MonthlySpendingSeriesResult> {
  const loadFrom = shiftDays(args.from, -45);
  const loadTo = shiftDays(args.to, 45);
  const rows = await fetchAllPages<any>((from, to) =>
    sb.from("transactions").select(TX_COLUMNS)
      .eq("user_id", args.user_id)
      .eq("status", "confirmed")
      .gte("occurred_at", loadFrom)
      .lte("occurred_at", loadTo)
      .order("occurred_at", { ascending: true })
      .range(from, to),
  { source: "monthly_spending_series" });

  const [aliases, referenced] = await Promise.all([
    loadAliases(sb, args.user_id),
    loadReferencedOriginals(sb, args.user_id, rows),
  ]);
  const universe = [...rows, ...referenced];
  const byId = new Map(universe.map((row: any) => [String(row.id), row]));
  const categoryAttribution = buildRefundAttribution(universe as TransactionRow[]);
  const categorySet = args.category_ids?.length ? new Set(args.category_ids.map(String)) : null;
  const resolver = buildMerchantResolver(aliases);
  const merchantQuery = String(args.merchant ?? "").trim() || null;

  const totals = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const raw of rows) {
    const row = { ...raw, amount: Number(raw.amount ?? 0) } as TransactionRow;
    const competence = reportingCompetenceDate(row);
    if (competence < args.from || competence > args.to) continue;

    const amount = behavioralMetricAmount(row, "expense");
    if (amount === 0) continue;

    if (categorySet) {
      const categoryId = effectiveCategoryId(row, categoryAttribution);
      if (!categoryId || !categorySet.has(String(categoryId))) continue;
    }

    if (merchantQuery) {
      const original = row.refund_of_transaction_id
        ? (byId.get(String(row.refund_of_transaction_id)) as TransactionRow | undefined)
        : undefined;
      const source = original ?? row;
      const merchant = resolver.resolve(source.description ?? null);
      if (!merchant || !merchantMatches(merchant.key, merchant.label, merchantQuery)) continue;
    }

    const month = competence.slice(0, 7);
    totals.set(month, round2((totals.get(month) ?? 0) + amount));
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }

  const monthKeys = monthsInWindow(args.from, args.to);
  const months = monthKeys.map((month) => ({
    month,
    total: round2(totals.get(month) ?? 0),
    has_data: (counts.get(month) ?? 0) > 0,
    transaction_count: counts.get(month) ?? 0,
  }));

  return {
    version: "nino_monthly_series.v1",
    formula_version: MONTHLY_SERIES_FORMULA_VERSION,
    months,
    total: round2(months.reduce((sum, point) => sum + point.total, 0)),
    transaction_count: months.reduce((sum, point) => sum + point.transaction_count, 0),
    window: { from: args.from, to: args.to, n: monthKeys.length },
    scope: {
      category: args.category_label?.trim() || null,
      merchant: merchantQuery,
    },
    partial_first_month: !args.from.endsWith("-01"),
    partial_last_month: args.to !== lastDayOfMonth(args.to),
  };
}

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function monthlyPointLabel(month: string): string {
  const [year, mm] = month.split("-").map(Number);
  return `${MONTH_LABELS[mm - 1]}/${String(year).slice(-2)}`;
}

export function monthlySpendingSeriesText(result: MonthlySpendingSeriesResult): string {
  const brl = (value: number) => value.toLocaleString("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const category = result.scope.category ? ` em ${result.scope.category}` : "";
  const merchant = result.scope.merchant ? ` no estabelecimento ${result.scope.merchant}` : "";
  const scope = `${category}${merchant}`;

  if (!result.months.some((point) => point.has_data)) {
    return `Não encontrei gastos${scope} entre ${result.window.from} e ${result.window.to}.`;
  }

  const points = result.months.map((point, index) => {
    const partial = (index === 0 && result.partial_first_month)
      || (index === result.months.length - 1 && result.partial_last_month);
    const value = point.has_data ? brl(point.total) : "sem lançamentos encontrados";
    return `${monthlyPointLabel(point.month)}${partial ? " (parcial)" : ""}: ${value}`;
  });

  return `Mês a mês${scope}: ${points.join("; ")}. Total no período: ${brl(result.total)}.`;
}

export function monthlySeriesExecutedIR(
  query: FinancialQueryV3,
  result: MonthlySpendingSeriesResult,
): ExecutedIR {
  return {
    metric: "expense_amount",
    filters: query.filters ?? [],
    time: {
      aspect: query.time.aspect,
      from: result.window.from,
      to: result.window.to,
      n: query.time.n,
      exclude_partial: query.time.exclude_partial,
    },
    grain: "month",
    // `none` here means the series itself is not collapsed; every bucket is a
    // deterministic sum. Preserve the requested semantic reduction exactly.
    reduce: query.reduce,
    group_by: query.group_by ?? [],
    partial: result.partial_first_month || result.partial_last_month,
  };
}
