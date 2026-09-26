from pathlib import Path
import re


def require_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"expected snippet not found: {label}")
    return text.replace(old, new, 1)


# 1) TypicalMonthlyHandler must use the canonical financial truth.
typical = Path("supabase/functions/_shared/agent/core/handlers/TypicalMonthlyHandler.ts")
text = typical.read_text()
text = require_replace(
    text,
    'import { reportingCompetenceDate } from "../../../finance-core/facts.ts";',
    '''import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  reportingCompetenceDate,
  type TransactionRow,
} from "../../../finance-core/facts.ts";''',
    "TypicalMonthlyHandler facts import",
)
text = require_replace(
    text,
    'const TX_COLUMNS = "amount,type,status,occurred_at,competence_date,payment_method,credit_card_id,category_id";',
    '''const TX_COLUMNS = [
  "id", "category_id", "type", "status", "amount", "occurred_at",
  "transfer_group_id", "payment_method", "credit_card_id", "settles_card_id",
  "movement_kind", "competence_date", "refund_of_transaction_id",
].join(",");''',
    "TypicalMonthlyHandler TX_COLUMNS",
)
start = text.index("export async function loadMonthlyExpenseBuckets(")
end = text.index("\nfunction shiftDays(", start)
new_fn = r'''export async function loadMonthlyExpenseBuckets(
  sb: any,
  args: {
    user_id: string;
    from: string;
    to: string;
    category_ids?: string[] | null;
  },
): Promise<MonthlyBucket[]> {
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
  { source: "typical_monthly" });

  // Refunds may inherit the category from the original purchase. If that
  // purchase fell outside the padded read window, load only referenced rows.
  const present = new Set(rows.map((row: any) => String(row.id)));
  const missingOriginalIds = [...new Set(rows
    .map((row: any) => String(row.refund_of_transaction_id ?? ""))
    .filter((id: string) => id && !present.has(id)))];
  const referenced: any[] = [];
  for (let offset = 0; offset < missingOriginalIds.length; offset += 200) {
    const ids = missingOriginalIds.slice(offset, offset + 200);
    const { data, error } = await sb.from("transactions").select(TX_COLUMNS)
      .eq("user_id", args.user_id).in("id", ids);
    if (!error && data?.length) referenced.push(...data);
  }

  const universe = [...rows, ...referenced] as TransactionRow[];
  const refundAttribution = buildRefundAttribution(universe);
  const categorySet = args.category_ids?.length
    ? new Set(args.category_ids.map(String))
    : null;
  const totals = new Map<string, number>();
  const observed = new Set<string>();

  for (const raw of rows) {
    const row = { ...raw, amount: Number(raw.amount ?? 0) } as TransactionRow;
    const competence = reportingCompetenceDate(row);
    if (competence < args.from || competence > args.to) continue;

    const amount = behavioralMetricAmount(row, "expense");
    if (amount === 0) continue;

    if (categorySet) {
      const categoryId = effectiveCategoryId(row, refundAttribution);
      if (!categoryId || !categorySet.has(String(categoryId))) continue;
    }

    const key = competence.slice(0, 7);
    totals.set(key, round2((totals.get(key) ?? 0) + amount));
    observed.add(key);
  }

  return monthsInWindow(args.from, args.to).map((month) => ({
    month,
    total: round2(totals.get(month) ?? 0),
    has_data: observed.has(month),
  }));
}
'''
text = text[:start] + new_fn + text[end:]
typical.write_text(text)


# 2) Factual past + "por mês" + explicit N-month window is an N-bucket series.
period = Path("supabase/functions/_shared/analytics/periodResolver.ts")
text = period.read_text()
trend_anchor = r'''const TREND_RX = /\b(evolu(cao|ção)|tendencia|trajetoria|ao longo do tempo|mes a mes|mes por mes|em cada mes|separad[oa] por mes|quebrad[oa] por mes|separ(e|a|ar) por mes|mostr(e|ar) por mes|trag(a|zer) por mes|list(e|ar) por mes|quebr(e|ar) por mes)\b/;'''
text = require_replace(
    text,
    trend_anchor,
    trend_anchor + r'''
const MONTHLY_RATE_RX = /\b(por mes|ao mes|cada mes)\b/;
const FACTUAL_MONTHLY_VERB_RX = /\b(gastei|recebi|paguei|desembolsei|foi|ficou|deu|somei|somou|totalizei)\b/;''',
    "periodResolver trend anchor",
)
aspect_anchor = "  const explicitPeriod = resolvePeriodPt(text, now);\n\n"
special = r'''  const explicitMonthWindow = t.match(new RegExp(`\bultimos?\s+(${MONTH_COUNT_TOKEN})\s+meses?\b`));
  const explicitMonthCount = explicitMonthWindow ? parseMonthCount(explicitMonthWindow[1]) : null;
  // Historical/factual past + "por mês" + explicit N-month window means a
  // decomposition into N calendar buckets, not the habitual 6-month statistic.
  // Present-tense "quanto gasto por mês" remains habitual below.
  if (explicitMonthCount && MONTHLY_RATE_RX.test(t) && FACTUAL_MONTHLY_VERB_RX.test(t)) {
    const wantsComplete = /\b(completos?|fechados?)\b/.test(t);
    if (wantsComplete) {
      const w = lastCompleteMonths(explicitMonthCount, now);
      return {
        aspect: "trend", from: w.from, to: w.to, n: explicitMonthCount, exclude_partial: true,
        grain: "month", reduce: "none", label: `últimos ${explicitMonthCount} meses completos, por mês`,
        matched: explicitMonthWindow?.[0] ?? "", assumption: null, ambiguous: false,
      };
    }
    const shifted = shiftMonthsClamped(todaySP(now), -(explicitMonthCount - 1));
    return {
      aspect: "trend", from: shifted.slice(0, 7) + "-01", to: todaySP(now),
      n: explicitMonthCount, exclude_partial: false, grain: "month", reduce: "none",
      label: `últimos ${explicitMonthCount} meses, por mês`, matched: explicitMonthWindow?.[0] ?? "",
      assumption: null, ambiguous: false,
    };
  }

'''
text = require_replace(text, aspect_anchor, aspect_anchor + special, "periodResolver aspect anchor")
period.write_text(text)


# 3) Overall trend is not a scoped category/merchant monthly-series handler.
irv3 = Path("supabase/functions/_shared/agent/core/FinancialIRv3.ts")
text = irv3.read_text()
old = '''  const groupSupported = (q.group_by?.length ?? 0) === 0
    || (q.group_by.length === 1 && q.group_by[0] === "month");
  return q.metric === "expense_amount"
    && q.grain === "month"
'''
new = '''  const groupSupported = (q.group_by?.length ?? 0) === 0
    || (q.group_by.length === 1 && q.group_by[0] === "month");
  const hasScopedFilter = filterFields.has("category") || filterFields.has("merchant");
  return q.metric === "expense_amount"
    && hasScopedFilter
    && q.grain === "month"
'''
text = require_replace(text, old, new, "FinancialIRv3 monthly series shape")
irv3.write_text(text)


# 4) Both core runtimes fail closed when category resolution is ambiguous.
for path in [
    "supabase/functions/_shared/agent/core/AgentCore.ts",
    "supabase/functions/_shared/agent/core/AgentCoreV2.ts",
]:
    p = Path(path)
    text = p.read_text()
    pattern = re.compile(
        r'(if \(categoryLabel && \(!categoryIds \|\| !categoryIds\.length\)\) \{\s*'
        r'return \{ domain_error: "category_not_found" as const \};\s*\})'
    )
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one monthly category guard in {path}, got {len(matches)}")
    replacement = matches[0].group(1) + '''
        if (categoryLabel && categoryIds && categoryIds.length > 1) {
          return { domain_error: "category_ambiguous" as const };
        }'''
    text = pattern.sub(lambda _: replacement, text, count=1)
    p.write_text(text)


# Phase-1 regression suite.
test = Path("src/test/nino-phase1-hardening.test.ts")
test.write_text(r'''import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveTimeAspectPt } from "../../supabase/functions/_shared/analytics/periodResolver.ts";
import { isMonthlySeriesShape } from "../../supabase/functions/_shared/agent/core/FinancialIRv3.ts";
import { loadMonthlyExpenseBuckets } from "../../supabase/functions/_shared/agent/core/handlers/TypicalMonthlyHandler.ts";

const NOW = new Date("2026-09-26T15:00:00-03:00");

function fakeSb(rows: any[]) {
  return {
    from(table: string) {
      if (table !== "transactions") throw new Error(`unexpected table ${table}`);
      const builder: any = {
        select() { return builder; },
        eq() { return builder; },
        gte() { return builder; },
        lte() { return builder; },
        order() { return builder; },
        range() { return Promise.resolve({ data: rows, error: null }); },
        in(_field: string, ids: string[]) {
          return Promise.resolve({ data: rows.filter((r) => ids.includes(String(r.id))), error: null });
        },
      };
      return builder;
    },
  };
}

describe("Nino Phase 1 hardening", () => {
  it("treats factual past + por mês + explicit N months as an N-bucket calendar series", () => {
    const aspect = resolveTimeAspectPt("Quanto gastei com Lazer por mês nos últimos 7 meses?", NOW);
    expect(aspect.aspect).toBe("trend");
    expect(aspect.grain).toBe("month");
    expect(aspect.n).toBe(7);
    expect(aspect.from).toBe("2026-03-01");
    expect(aspect.to).toBe("2026-09-26");
  });

  it("keeps present-tense quanto gasto por mês as habitual", () => {
    const aspect = resolveTimeAspectPt("Quanto gasto por mês com Lazer?", NOW);
    expect(aspect.aspect).toBe("habitual");
    expect(aspect.exclude_partial).toBe(true);
    expect(aspect.n).toBe(6);
  });

  it("does not let the scoped monthly handler steal an overall trend", () => {
    const base: any = {
      id: "q1", metric: "expense_amount", filters: [],
      time: { aspect: "trend", from: "2026-04-01", to: "2026-09-26", n: 6, exclude_partial: false, label: "6 meses" },
      grain: "month", reduce: "none", group_by: ["month"], limit: null, depends_on: [], legacy_operation: "trend",
    };
    expect(isMonthlySeriesShape(base)).toBe(false);
    expect(isMonthlySeriesShape({
      ...base,
      filters: [{ field: "category", op: "eq", value: "Lazer" }],
    })).toBe(true);
  });

  it("typical monthly uses canonical consumption truth and refund attribution", async () => {
    const rows = [
      { id: "purchase", category_id: "lazer", type: "expense", status: "confirmed", amount: 100,
        occurred_at: "2026-05-10", competence_date: "2026-05-10", payment_method: "account",
        credit_card_id: null, transfer_group_id: null, settles_card_id: null, movement_kind: "transaction",
        refund_of_transaction_id: null },
      { id: "refund", category_id: null, type: "income", status: "confirmed", amount: 20,
        occurred_at: "2026-05-15", competence_date: "2026-05-15", payment_method: "account",
        credit_card_id: null, transfer_group_id: null, settles_card_id: null, movement_kind: "refund",
        refund_of_transaction_id: "purchase" },
      { id: "bill", category_id: "lazer", type: "expense", status: "confirmed", amount: 300,
        occurred_at: "2026-05-20", competence_date: "2026-05-20", payment_method: "account",
        credit_card_id: null, transfer_group_id: null, settles_card_id: "card-1", movement_kind: "transaction",
        refund_of_transaction_id: null },
      { id: "investment", category_id: "lazer", type: "expense", status: "confirmed", amount: 500,
        occurred_at: "2026-05-21", competence_date: "2026-05-21", payment_method: "account",
        credit_card_id: null, transfer_group_id: null, settles_card_id: null, movement_kind: "investment_application",
        refund_of_transaction_id: null },
      { id: "transfer", category_id: "lazer", type: "expense", status: "confirmed", amount: 200,
        occurred_at: "2026-05-22", competence_date: "2026-05-22", payment_method: "account",
        credit_card_id: null, transfer_group_id: "pair-1", settles_card_id: null, movement_kind: "transaction",
        refund_of_transaction_id: null },
    ];

    const buckets = await loadMonthlyExpenseBuckets(fakeSb(rows) as any, {
      user_id: "u1", from: "2026-05-01", to: "2026-05-31", category_ids: ["lazer"],
    });
    expect(buckets).toEqual([{ month: "2026-05", total: 80, has_data: true }]);
  });

  it("both runtimes fail closed on ambiguous category resolution", () => {
    for (const path of [
      "supabase/functions/_shared/agent/core/AgentCore.ts",
      "supabase/functions/_shared/agent/core/AgentCoreV2.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("categoryIds.length > 1");
      expect(source).toContain('domain_error: "category_ambiguous" as const');
    }
  });
});
''')

print("phase1 hardening patch applied")
