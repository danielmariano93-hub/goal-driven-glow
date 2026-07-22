import { describe, it, expect } from "vitest";
import { computeAvailableUntil, type AccountRow, type TransactionRow, type RecurringRow } from "@/lib/engine/facts";

const acc: AccountRow[] = [{ id: "a1", name: "CC", type: "checking", opening_balance: 1000, active: true }];

describe("computeAvailableUntil", () => {
  const today = new Date("2026-07-15T12:00:00Z");

  it("saldo puro sem compromissos = caixa atual", () => {
    const r = computeAvailableUntil({ accounts: acc, txs: [], recurring: [], endDate: "2026-07-31", today });
    expect(r.currentCash).toBe(1000);
    expect(r.available).toBe(1000);
  });

  it("desconta despesa planejada e fatura em aberto", () => {
    const txs: TransactionRow[] = [
      { id: "t1", account_id: "a1", category_id: null, type: "expense", status: "planned", amount: 200, occurred_at: "2026-07-25", description: null, transfer_group_id: null, payment_method: "account" },
      { id: "t2", account_id: "a1", category_id: null, type: "expense", status: "confirmed", amount: 150, occurred_at: "2026-07-10", description: null, transfer_group_id: null, payment_method: "credit_card", credit_card_id: "c1" },
    ];
    const r = computeAvailableUntil({ accounts: acc, txs, recurring: [], endDate: "2026-07-31", today });
    expect(r.plannedExpense).toBe(200);
    expect(r.cardsOwed).toBe(150);
    expect(r.available).toBe(650);
  });

  it("soma entradas recorrentes futuras no horizonte", () => {
    const rec: RecurringRow[] = [
      { id: "r1", name: "Salário", type: "income", amount: 3000, frequency: "monthly", next_due_date: "2026-07-20", active: true },
    ];
    const r = computeAvailableUntil({ accounts: acc, txs: [], recurring: rec, endDate: "2026-07-31", today });
    expect(r.recurringIn).toBe(3000);
    expect(r.available).toBe(4000);
  });

  it("ignora recorrências fora do horizonte", () => {
    const rec: RecurringRow[] = [
      { id: "r1", name: "Aluguel", type: "expense", amount: 900, frequency: "monthly", next_due_date: "2026-08-05", active: true },
    ];
    const r = computeAvailableUntil({ accounts: acc, txs: [], recurring: rec, endDate: "2026-07-31", today });
    expect(r.recurringOut).toBe(0);
    expect(r.available).toBe(1000);
  });
});
