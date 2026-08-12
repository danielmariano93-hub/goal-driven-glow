import { describe, it, expect } from "vitest";
import { byCategory, type ReportTxn } from "@/lib/reports/aggregations";
import { buildRefundAttribution, effectiveCategoryId } from "@/lib/engine/facts";
import { computeDebtStatus } from "@/lib/engine/debtStatus";

// finance_truth.v1 — um estorno deve abater a categoria econômica original
// da compra em TODA superfície (Relatórios, Metas, Nino, WhatsApp).
const purchase = {
  id: "tx-purchase",
  type: "expense",
  status: "confirmed",
  amount: 674.75,
  occurred_at: "2026-08-03",
  category_id: "cat-transporte",
  category_name: "Transporte",
  movement_kind: "transaction",
} as unknown as ReportTxn;

const refund = {
  id: "tx-refund",
  type: "income",
  status: "confirmed",
  amount: 213.93,
  occurred_at: "2026-08-08",
  category_id: "cat-outros",
  category_name: "Outros",
  movement_kind: "refund",
  refund_of_transaction_id: "tx-purchase",
} as unknown as ReportTxn;

describe("finance_truth.v1 — atribuição de estorno", () => {
  it("abate o estorno na categoria original da compra", () => {
    const attribution = buildRefundAttribution([purchase, refund] as never);
    expect(effectiveCategoryId(refund as never, attribution)).toBe("cat-transporte");
  });

  it("byCategory retorna o valor líquido da categoria original", () => {
    const rows = byCategory([purchase, refund], [purchase, refund]);
    const transporte = rows.find((r) => r.category === "Transporte");
    expect(transporte?.total).toBeCloseTo(460.82, 2);
    expect(rows.find((r) => r.category === "Outros")).toBeUndefined();
  });
});

describe("debt_status.v1", () => {
  it("marca parcela vencida sem pagamento como em atraso", () => {
    const out = computeDebtStatus({
      debts: [{
        id: "d1",
        name: "Financiamento",
        outstanding_balance: 1200,
        installment_amount: 300,
        due_day: 5,
        first_due_date: "2026-05-05",
        installments_total: 10,
        status: "active",
      }] as never,
      payments: [],
      today: "2026-08-12",
    });
    expect(out.facts.overdue_count).toBe(1);
    expect(out.breakdown[0]?.situation).toBe("em_atraso");
    expect(out.breakdown[0]?.days_overdue).toBeGreaterThan(0);
  });
});
