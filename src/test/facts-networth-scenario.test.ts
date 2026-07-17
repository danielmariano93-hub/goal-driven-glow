import { describe, it, expect } from "vitest";
import {
  computeAccountBalances,
  computeCreditCardOutstanding,
  computeNetWorth,
  txOrigin,
  type AccountRow,
  type TransactionRow,
} from "@/lib/engine/facts";

// Cenário-âncora do plano:
// abertura R$100,00; despesas em conta R$198,67; despesas no cartão R$131,51.
// cash = -98,67; cardsOwed = 131,51; net = -230,18.

const acc = (id: string, opening: number): AccountRow => ({
  id,
  name: id,
  type: "checking",
  opening_balance: opening,
  active: true,
});

const tx = (o: Partial<TransactionRow> & Pick<TransactionRow, "id" | "account_id" | "type" | "amount" | "occurred_at">): TransactionRow => ({
  category_id: null,
  status: "confirmed",
  description: null,
  transfer_group_id: null,
  ...o,
});

describe("cenário-âncora patrimônio (R$100 / R$198,67 / R$131,51)", () => {
  const accounts = [acc("a", 100)];
  const txs: TransactionRow[] = [
    tx({ id: "1", account_id: "a", type: "expense", amount: 98.67, occurred_at: "2026-07-01", payment_method: "account" }),
    tx({ id: "2", account_id: "a", type: "expense", amount: 50, occurred_at: "2026-07-02", payment_method: "account" }),
    tx({ id: "3", account_id: "a", type: "expense", amount: 50, occurred_at: "2026-07-03", payment_method: "account" }),
    tx({ id: "4", account_id: "a", type: "expense", amount: 100.51, occurred_at: "2026-07-04", payment_method: "credit_card", credit_card_id: "c1" }),
    tx({ id: "5", account_id: "a", type: "expense", amount: 31, occurred_at: "2026-07-05", payment_method: "credit_card", credit_card_id: "c1" }),
  ];

  it("saldo em conta ignora despesas de cartão", () => {
    const b = computeAccountBalances(accounts, txs);
    expect(b.a).toBe(-98.67);
  });

  it("fatura em aberto = soma das despesas no cartão", () => {
    expect(computeCreditCardOutstanding(txs)).toBe(131.51);
  });

  it("patrimônio líquido separa conta e cartão", () => {
    const nw = computeNetWorth(accounts, txs, [], []);
    expect(nw.cash).toBe(-98.67);
    expect(nw.cardsOwed).toBe(131.51);
    expect(nw.otherDebts).toBe(0);
    expect(nw.net).toBe(-230.18);
  });

  it("txOrigin: legado sem payment_method com credit_card_id é cartão", () => {
    expect(txOrigin({ payment_method: null, credit_card_id: "x" })).toBe("credit_card");
    expect(txOrigin({ payment_method: null, credit_card_id: null })).toBe("account");
    expect(txOrigin({ payment_method: "credit_card", credit_card_id: null })).toBe("credit_card");
  });
});
