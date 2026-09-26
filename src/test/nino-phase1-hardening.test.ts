import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveTimeAspectPt } from "../../supabase/functions/_shared/analytics/periodResolver.ts";
import { isMonthlySeriesShape } from "../../supabase/functions/_shared/agent/core/FinancialIRv3.ts";
import {
  loadMonthlyExpenseBuckets,
  typicalMonthlyPolicy,
  typicalMonthlyText,
} from "../../supabase/functions/_shared/agent/core/handlers/TypicalMonthlyHandler.ts";

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

  it("explains why typical median differs from the arithmetic mean and names the months that drive it", () => {
    const window = { from: "2026-03-01", to: "2026-08-31", n: 6 };
    const result = typicalMonthlyPolicy({
      window,
      preferred: "typical",
      buckets: [
        { month: "2026-03", total: 44.90, has_data: true },
        { month: "2026-04", total: 80.00, has_data: true },
        { month: "2026-05", total: 93.00, has_data: true },
        { month: "2026-06", total: 93.84, has_data: true },
        { month: "2026-07", total: 2625.23, has_data: true },
        { month: "2026-08", total: 1465.00, has_data: true },
      ],
    });

    expect(result.median).toBe(93.42);
    expect(result.mean).toBe(733.66);
    expect(result.divergent).toBe(true);

    const text = typicalMonthlyText(result, "Assinaturas");
    expect(text).toContain("Seu gasto típico com Assinaturas é de R$ 93,42 por mês.");
    expect(text).toContain("mediana dos últimos 6 meses fechados");
    expect(text).toContain("média aritmética no mesmo período foi de R$ 733,66");
    expect(text).toContain("julho (R$ 2.625,23) e agosto (R$ 1.465,00)");
    expect(text).toContain("puxaram a média para cima");
    expect(text).toContain("R$ 93,42 representa melhor o que você costuma gastar em um mês normal");
    expect(text).not.toContain("Mediana e média ficam distantes");
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
