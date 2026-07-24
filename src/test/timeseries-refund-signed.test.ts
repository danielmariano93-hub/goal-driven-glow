import { describe, it, expect } from "vitest";
import { computeDailySpend } from "../../supabase/functions/_shared/analytics/timeseries";
import { FORMULA_VERSION as SQL_FORMULA } from "../../supabase/functions/_shared/engine/facts";

// Garante que timeseries preserva o sinal de dias com estorno líquido negativo
// (contabilidade honesta) e que o total continua consistente.
const base = {
  id: "t",
  account_id: "a1",
  category_id: null,
  description: null,
  transfer_group_id: null,
  credit_card_id: null,
  settles_card_id: null,
  payment_method: "account",
} as any;

describe("computeDailySpend — sinal preservado em estornos", () => {
  it("dia com estorno maior que consumo aparece negativo", () => {
    const from = "2026-07-01";
    const to = "2026-07-03";
    const txs = [
      { ...base, id: "1", type: "expense", status: "confirmed", movement_kind: "transaction", amount: 30, occurred_at: "2026-07-01" },
      { ...base, id: "2", type: "expense", status: "confirmed", movement_kind: "transaction", amount: 20, occurred_at: "2026-07-02" },
      { ...base, id: "3", type: "income", status: "confirmed", movement_kind: "refund", amount: 100, occurred_at: "2026-07-02" },
      { ...base, id: "4", type: "expense", status: "confirmed", movement_kind: "transaction", amount: 10, occurred_at: "2026-07-03" },
    ];
    const r = computeDailySpend({ txs, metric: "expense", from, to });
    expect(r.labels).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
    expect(r.daily).toEqual([30, -80, 10]);
    expect(r.total).toBe(-40);
    // 3 dias com dado (incluindo o negativo) → média = -40/3 ≈ -13.33
    expect(r.daily_avg).toBeCloseTo(-13.33, 2);
  });

  it("formula_version do provenance casa com a constante SQL", () => {
    // O timeseries usa sua própria formula_version curta ('timeseries.daily.v1'),
    // mas o motor comportamental subjacente deve declarar financial_daily.v2.
    expect(SQL_FORMULA).toBe("financial_daily.v2");
    const r = computeDailySpend({ txs: [], metric: "expense", from: "2026-07-01", to: "2026-07-01" });
    expect(r.provenance.formula_version).toBe("timeseries.daily.v1");
  });
});
