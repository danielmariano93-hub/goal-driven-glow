import { describe, it, expect } from "vitest";
import { computeMonthlyTotals } from "@/lib/engine/facts";

// Guarda que aplicação/resgate/rendimento/loan_proceeds/refund/fatura não
// distorcem o balanço comportamental. Refund abate despesa. Transferências
// internas não entram. Renda/gasto de "transaction" contam normalmente.
describe("computeMonthlyTotals — escopo comportamental v1", () => {
  const month = "2026-07";
  const base = { account_id: "a1", credit_card_id: null, settles_card_id: null };

  const txns = [
    // Rendas reais
    { type: "income", amount: 5000, occurred_at: "2026-07-05", status: "confirmed", movement_kind: "transaction", ...base },
    // Gasto real
    { type: "expense", amount: 300, occurred_at: "2026-07-10", status: "confirmed", movement_kind: "transaction", ...base },
    // Estorno abate despesa
    { type: "income", amount: 50, occurred_at: "2026-07-11", status: "confirmed", movement_kind: "refund", ...base },
    // Ruídos patrimoniais — devem sumir do comportamental
    { type: "expense", amount: 5000, occurred_at: "2026-07-12", status: "confirmed", movement_kind: "investment_application", ...base },
    { type: "income", amount: 5000, occurred_at: "2026-07-13", status: "confirmed", movement_kind: "investment_redemption", ...base },
    { type: "income", amount: 42.5, occurred_at: "2026-07-14", status: "confirmed", movement_kind: "investment_yield", ...base },
    { type: "income", amount: 2000, occurred_at: "2026-07-15", status: "confirmed", movement_kind: "loan_proceeds", ...base },
    // Fatura de cartão (settles) e transferência não contam
    { type: "expense", amount: 800, occurred_at: "2026-07-20", status: "confirmed", movement_kind: "card_bill_payment", account_id: "a1", credit_card_id: null, settles_card_id: "c1" },
    { type: "transfer", amount: 400, occurred_at: "2026-07-22", status: "confirmed", movement_kind: "transaction", account_id: "a1", credit_card_id: null, settles_card_id: null },
    // Planejado não conta
    { type: "expense", amount: 999, occurred_at: "2026-07-28", status: "planned", movement_kind: "transaction", ...base },
  ] as never[];

  const totals = computeMonthlyTotals(txns, month);

  it("expense_month é gasto real menos estorno", () => {
    expect(totals.expense).toBe(250);
  });

  it("income_month não inclui rendimento, resgate nem crédito de empréstimo", () => {
    expect(totals.income).toBe(5000);
  });

  it("balance é diferença simples", () => {
    expect(totals.balance).toBe(4750);
  });
});
