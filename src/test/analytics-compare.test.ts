import { describe, it, expect } from "vitest";
import { computeCompare } from "../../supabase/functions/_shared/analytics/compare";
import type { TransactionRow } from "../../supabase/functions/_shared/engine/facts";

function tx(over: Partial<TransactionRow>): TransactionRow {
  return {
    id: crypto.randomUUID(), account_id: "a", category_id: null,
    type: "expense", status: "confirmed", amount: 0, occurred_at: "2026-07-01",
    description: null, transfer_group_id: null, movement_kind: "transaction",
    ...over,
  };
}

const names = new Map([["c1", "Lazer"], ["c2", "Mercado"]]);

describe("computeCompare", () => {
  it("soma somente movimentos reais e ignora transferências", () => {
    const txs = [
      tx({ amount: 100, occurred_at: "2026-06-05", category_id: "c1" }),
      tx({ amount: 200, occurred_at: "2026-07-05", category_id: "c1" }),
      tx({ amount: 999, occurred_at: "2026-07-06", type: "transfer" }),
      tx({ amount: 50, occurred_at: "2026-07-10", category_id: "c2" }),
    ];
    const r = computeCompare({
      txs, categoryNames: names, metric: "expense",
      period_a: { from: "2026-06-01", to: "2026-06-30" },
      period_b: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(r.total_a).toBe(100);
    expect(r.total_b).toBe(250);
    expect(r.delta_abs).toBe(150);
    expect(r.by_group.find(g => g.name === "Lazer")?.delta_abs).toBe(100);
  });

  it("provenance carrega formula_version e confidence", () => {
    const r = computeCompare({
      txs: [], categoryNames: names, metric: "expense",
      period_a: { from: "2026-06-01", to: "2026-06-30" },
      period_b: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(r.provenance.formula_version).toBe("compare.v1");
    expect(r.provenance.confidence).toBe("insufficient_data");
  });

  it("períodos de tamanhos diferentes marcam comparable=false", () => {
    const r = computeCompare({
      txs: [], categoryNames: names, metric: "expense",
      period_a: { from: "2026-06-01", to: "2026-06-30" },
      period_b: { from: "2026-07-01", to: "2026-07-10" },
    });
    expect(r.comparable).toBe(false);
  });
});
