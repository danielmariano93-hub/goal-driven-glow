import { describe, it, expect } from "vitest";
import {
  computeAccountStatementTotals,
  type TransactionRow,
} from "@/lib/engine/facts";

const base: Omit<TransactionRow, "id" | "type" | "amount" | "occurred_at"> = {
  account_id: "acc1",
  category_id: null,
  status: "confirmed",
  description: null,
  transfer_group_id: null,
  payment_method: "account",
  credit_card_id: null,
  movement_kind: "transaction",
};

const tx = (over: Partial<TransactionRow> & Pick<TransactionRow, "id" | "type" | "amount" | "occurred_at">): TransactionRow =>
  ({ ...base, ...over });

const range = { start: "2026-07-01", end: "2026-07-31" };

describe("computeAccountStatementTotals", () => {
  it("resgate de investimento conta como entrada bruta", () => {
    const t = computeAccountStatementTotals(
      [tx({ id: "1", type: "income", amount: 1000.31, occurred_at: "2026-07-01", movement_kind: "investment_redemption" })],
      range,
    );
    expect(t.accountIn).toBe(1000.31);
    expect(t.accountOut).toBe(0);
  });

  it("estorno conta como entrada bruta e não abate saída", () => {
    const t = computeAccountStatementTotals(
      [
        tx({ id: "1", type: "expense", amount: 100, occurred_at: "2026-07-05" }),
        tx({ id: "2", type: "income", amount: 40, occurred_at: "2026-07-06", movement_kind: "refund" }),
      ],
      range,
    );
    expect(t.accountIn).toBe(40);
    expect(t.accountOut).toBe(100);
  });

  it("aplicação em investimento conta como saída bruta", () => {
    const t = computeAccountStatementTotals(
      [tx({ id: "1", type: "expense", amount: 5000, occurred_at: "2026-07-03", movement_kind: "investment_application" })],
      range,
    );
    expect(t.accountOut).toBe(5000);
  });

  it("despesa em cartão de crédito fica em cardOut, separada da conta", () => {
    const t = computeAccountStatementTotals(
      [
        tx({ id: "1", type: "expense", amount: 271.88, occurred_at: "2026-07-10", payment_method: "credit_card", credit_card_id: "card1" }),
        tx({ id: "2", type: "expense", amount: 50, occurred_at: "2026-07-10" }),
      ],
      range,
    );
    expect(t.accountOut).toBe(50);
    expect(t.cardOut).toBe(271.88);
  });

  it("transferência entre contas próprias se cancela no consolidado", () => {
    const t = computeAccountStatementTotals(
      [
        tx({ id: "a", account_id: "acc1", type: "transfer", amount: 200, occurred_at: "2026-07-15", transfer_group_id: "g1" }),
        tx({ id: "b", account_id: "acc2", type: "transfer", amount: 200, occurred_at: "2026-07-15", transfer_group_id: "g1" }),
      ],
      range,
    );
    expect(t.accountIn).toBe(0);
    expect(t.accountOut).toBe(0);
  });

  it("com scopeAccountId, perna do transfer aparece na conta escopada", () => {
    const txs = [
      tx({ id: "a", account_id: "acc1", type: "transfer", amount: 200, occurred_at: "2026-07-15", transfer_group_id: "g1" }),
      tx({ id: "b", account_id: "acc2", type: "transfer", amount: 200, occurred_at: "2026-07-15", transfer_group_id: "g1" }),
    ];
    const t1 = computeAccountStatementTotals(txs, range, { scopeAccountId: "acc1" });
    expect(t1.accountOut).toBe(200);
    const t2 = computeAccountStatementTotals(txs, range, { scopeAccountId: "acc2" });
    expect(t2.accountIn).toBe(200);
  });

  it("settles_card_id ignorado nos totais de conta", () => {
    const t = computeAccountStatementTotals(
      [tx({ id: "1", type: "expense", amount: 271.88, occurred_at: "2026-07-20", settles_card_id: "card1" })],
      range,
    );
    expect(t.accountOut).toBe(0);
  });

  it("contrato numérico: julho danielmariano93 — 11193.82 / 14893.54 / 271.88", () => {
    // Dataset sintético representando os totais brutos validados em produção.
    const txs: TransactionRow[] = [
      // Entradas brutas (transaction + resgates + estorno) = 11.193,82
      tx({ id: "in-tx", type: "income", amount: 9528.40, occurred_at: "2026-07-03" }),
      tx({ id: "in-r1", type: "income", amount: 1501.14, occurred_at: "2026-07-01", movement_kind: "investment_redemption" }),
      tx({ id: "in-est", type: "income", amount: 164.28, occurred_at: "2026-07-10", movement_kind: "refund" }),
      // Saídas brutas da conta = 14.893,54
      tx({ id: "out-tx", type: "expense", amount: 9893.54, occurred_at: "2026-07-05" }),
      tx({ id: "out-ap", type: "expense", amount: 5000.00, occurred_at: "2026-07-03", movement_kind: "investment_application" }),
      // Cartão separado = 271,88
      tx({ id: "card", type: "expense", amount: 271.88, occurred_at: "2026-07-12", payment_method: "credit_card", credit_card_id: "cc1" }),
    ];
    const t = computeAccountStatementTotals(txs, range);
    expect(t.accountIn).toBe(11193.82);
    expect(t.accountOut).toBe(14893.54);
    expect(t.cardOut).toBe(271.88);
    expect(t.net).toBe(-3971.60);
  });
});
