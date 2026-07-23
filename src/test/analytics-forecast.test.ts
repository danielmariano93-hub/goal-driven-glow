import { describe, it, expect } from "vitest";
import { computeForecast } from "../../supabase/functions/_shared/analytics/forecast";
import type { TransactionRow } from "../../supabase/functions/_shared/engine/facts";

const t = (o: Partial<TransactionRow>): TransactionRow => ({
  id: crypto.randomUUID(), account_id: "a", category_id: null, type: "expense",
  status: "confirmed", amount: 0, occurred_at: "2026-07-15",
  description: null, transfer_group_id: null, movement_kind: "transaction", ...o,
});

describe("computeForecast", () => {
  it("insufficient_data quando quase não há registros", () => {
    const r = computeForecast({ txs: [], today: "2026-07-05" });
    expect(r.provenance.confidence).toBe("insufficient_data");
    expect(r.point).toBe(0);
  });

  it("projeta linear pelo baseline quando não há recorrentes", () => {
    // 10 dias com R$50/dia → mês de 31 dias → previsão ≈ 1550
    const txs = Array.from({ length: 10 }, (_, i) => t({ amount: 50, occurred_at: `2026-07-${String(i + 1).padStart(2, "0")}` }));
    const r = computeForecast({ txs, today: "2026-07-10", model: "baseline" });
    expect(r.model_used).toContain("baseline");
    expect(r.point).toBeGreaterThan(1400);
    expect(r.point).toBeLessThan(1700);
  });

  it("ignora transferências e não infla previsão", () => {
    const real = Array.from({ length: 10 }, (_, i) => t({ amount: 50, occurred_at: `2026-07-${String(i + 1).padStart(2, "0")}` }));
    const withTransfers = [...real, t({ amount: 5000, type: "transfer", occurred_at: "2026-07-05" })];
    const a = computeForecast({ txs: real, today: "2026-07-10", model: "baseline" });
    const b = computeForecast({ txs: withTransfers, today: "2026-07-10", model: "baseline" });
    expect(b.point).toBe(a.point);
  });
});
