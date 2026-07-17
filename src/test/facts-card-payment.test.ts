import { describe, it, expect } from "vitest";
import {
  computeAccountBalances,
  computeCreditCardOutstanding,
  computeNetWorth,
  type AccountRow,
  type TransactionRow,
} from "@/lib/engine/facts";

const acc = (id: string, opening: number): AccountRow => ({
  id, name: id, type: "checking", opening_balance: opening, active: true,
});
const tx = (o: Partial<TransactionRow> & Pick<TransactionRow, "id" | "account_id" | "type" | "amount" | "occurred_at">): TransactionRow => ({
  category_id: null, status: "confirmed", description: null, transfer_group_id: null, ...o,
});

describe("pagamento de fatura não duplica despesa", () => {
  const accounts = [acc("a", 100)];
  const base: TransactionRow[] = [
    tx({ id: "1", account_id: "a", type: "expense", amount: 98.67, occurred_at: "2026-07-01", payment_method: "account" }),
    tx({ id: "2", account_id: "a", type: "expense", amount: 50, occurred_at: "2026-07-02", payment_method: "account" }),
    tx({ id: "3", account_id: "a", type: "expense", amount: 50, occurred_at: "2026-07-03", payment_method: "account" }),
    tx({ id: "4", account_id: "a", type: "expense", amount: 100.51, occurred_at: "2026-07-04", payment_method: "credit_card", credit_card_id: "c1" }),
    tx({ id: "5", account_id: "a", type: "expense", amount: 31, occurred_at: "2026-07-05", payment_method: "credit_card", credit_card_id: "c1" }),
  ];

  it("cenário-âncora antes do pagamento", () => {
    const nw = computeNetWorth(accounts, base, [], []);
    expect(nw.cash).toBe(-98.67);
    expect(nw.cardsOwed).toBe(131.51);
    expect(nw.net).toBe(-230.18);
  });

  it("após pagar a fatura integralmente pela conta, cash cai, cardsOwed zera, patrimônio inalterado", () => {
    const pay = tx({
      id: "6",
      account_id: "a",
      type: "expense",
      amount: 131.51,
      occurred_at: "2026-07-10",
      payment_method: "account",
      settles_card_id: "c1",
    });
    const txs = [...base, pay];
    const balances = computeAccountBalances(accounts, txs);
    expect(balances.a).toBe(-230.18);
    expect(computeCreditCardOutstanding(txs)).toBe(0);
    const nw = computeNetWorth(accounts, txs, [], []);
    expect(nw.cash).toBe(-230.18);
    expect(nw.cardsOwed).toBe(0);
    expect(nw.net).toBe(-230.18);
  });
});
