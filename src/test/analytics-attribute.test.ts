import { describe, it, expect } from "vitest";
import { computeCompare } from "../../supabase/functions/_shared/analytics/compare";
import { computeAttribution } from "../../supabase/functions/_shared/analytics/attribute";
import type { TransactionRow } from "../../supabase/functions/_shared/engine/facts";

const names = new Map([["c1", "Lazer"], ["c2", "Mercado"], ["c3", "Transporte"]]);
const t = (o: Partial<TransactionRow>): TransactionRow => ({
  id: crypto.randomUUID(), account_id: "a", category_id: null, type: "expense",
  status: "confirmed", amount: 0, occurred_at: "2026-07-01",
  description: null, transfer_group_id: null, movement_kind: "transaction", ...o,
});

describe("computeAttribution", () => {
  it("atribui contribuição por categoria proporcional ao delta positivo", () => {
    const txs = [
      t({ amount: 100, occurred_at: "2026-06-01", category_id: "c1" }),
      t({ amount: 300, occurred_at: "2026-07-01", category_id: "c1" }), // +200
      t({ amount: 100, occurred_at: "2026-06-02", category_id: "c2" }),
      t({ amount: 200, occurred_at: "2026-07-02", category_id: "c2" }), // +100
      t({ amount: 200, occurred_at: "2026-06-03", category_id: "c3" }),
      t({ amount: 100, occurred_at: "2026-07-03", category_id: "c3" }), // -100
    ];
    const cmp = computeCompare({
      txs, categoryNames: names, metric: "expense",
      period_a: { from: "2026-06-01", to: "2026-06-30" },
      period_b: { from: "2026-07-01", to: "2026-07-31" },
    });
    const a = computeAttribution(cmp);
    expect(a.delta_total).toBe(200);
    expect(a.positive_delta_total).toBe(300);
    const lazer = a.contributions.find(c => c.name === "Lazer")!;
    const merc = a.contributions.find(c => c.name === "Mercado")!;
    expect(lazer.pct_of_positive_delta).toBeCloseTo(200 / 300, 3);
    expect(merc.pct_of_positive_delta).toBeCloseTo(100 / 300, 3);
    expect(a.contributions.find(c => c.name === "Transporte")!.direction).toBe("down");
  });
});
