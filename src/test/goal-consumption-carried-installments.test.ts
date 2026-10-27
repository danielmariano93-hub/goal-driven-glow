// `goal_consumption.v1` — a meta mede o que o usuário decide gastar NO MÊS.
// Parcela 2+ de compra parcelada no cartão é compromisso de compra anterior:
// não consome meta, submeta, base nem projeção; aparece numa linha à parte.
import { describe, expect, it } from "vitest";
import {
  computeCategoryBaseline,
  evaluateCategoryGoal,
  type CategorySpendingGoalRow,
} from "@/lib/engine/metrics";
import { buildSpendingLedger } from "@/lib/engine/spendingGoals";
import { buildCarriedInstallmentIds, type TransactionRow } from "@/lib/engine/facts";

const CAT = "cat-transporte";
const today = new Date("2026-10-26T12:00:00");

function card(over: Partial<TransactionRow> & { id: string; amount: number }): TransactionRow {
  return {
    account_id: "",
    category_id: CAT,
    type: "expense",
    status: "confirmed",
    occurred_at: "2026-10-10",
    description: "Turbi",
    transfer_group_id: null,
    payment_method: "credit_card",
    credit_card_id: "card-1",
    competence_date: "2026-10-01",
    movement_kind: "transaction",
    installment_number: null,
    installments_total: null,
    ...over,
  } as TransactionRow;
}

const goal = {
  id: "g1", user_id: "u1", category_id: CAT, mode: "fixed_limit", reduction_pct: null,
  fixed_limit: 1000, baseline_kind: "custom", baseline_value: 1000, computed_limit: 1000,
  frequency: "monthly", start_date: "2026-10-01", end_date: "2026-10-31", status: "active",
  period_type: "this_month",
} as CategorySpendingGoalRow;

describe("buildCarriedInstallmentIds", () => {
  const ids = (list: TransactionRow[]) => [...buildCarriedInstallmentIds(list)].sort();

  it("só parcela 2+ de compra parcelada no cartão", () => {
    expect(ids([card({ id: "a", amount: 1, installment_number: 1, installments_total: 4 })])).toEqual([]);
    expect(ids([card({ id: "b", amount: 1, occurred_at: "2026-07-26", purchase_date: "2026-07-26", installment_number: 3, installments_total: 4 })])).toEqual(["b"]);
    expect(ids([card({ id: "c", amount: 1 })])).toEqual([]);
    expect(ids([card({ id: "d", amount: 1, installment_number: 3, installments_total: 3, credit_card_id: null, payment_method: "account" })])).toEqual([]);
  });

  it("compra deste ciclo antecipada (parcelas 1..6 na mesma fatura) NÃO é carregada", () => {
    const list = [1, 2, 3, 4, 5, 6].map((k) => card({
      id: `jim-${k}`, amount: 545.13, occurred_at: "2026-09-30", purchase_date: "2026-09-30",
      installment_number: k, installments_total: 6, purchase_group_id: "g-jim",
    }));
    expect(ids(list)).toEqual([]);
  });

  it("parcela cuja compra tem parcela anterior em outra fatura é carregada", () => {
    const list = [
      card({ id: "loc-1", amount: 264.3, occurred_at: "2026-09-04", purchase_date: "2026-09-04", competence_date: "2026-09-01", installment_number: 1, installments_total: 3, purchase_group_id: "g-loc" }),
      card({ id: "loc-2", amount: 264.3, occurred_at: "2026-09-04", purchase_date: "2026-09-04", competence_date: "2026-10-01", installment_number: 2, installments_total: 3, purchase_group_id: "g-loc" }),
    ];
    expect(ids(list)).toEqual(["loc-2"]);
  });
});

describe("meta por categoria", () => {
  const txs = [
    card({ id: "old1", amount: 629.18, occurred_at: "2026-07-26", installment_number: 3, installments_total: 4 }),
    card({ id: "new1", amount: 69.9, installment_number: 1, installments_total: 4 }),
    card({ id: "new2", amount: 66, installment_number: null, installments_total: null }),
  ];

  it("não consome a meta com parcela de compra anterior e informa o comprometido", () => {
    const ev = evaluateCategoryGoal(goal, txs, today, "Transporte");
    expect(ev.actualSpend).toBe(135.9);
    expect(ev.carriedInstallments).toBe(629.18);
    expect(ev.carriedInstallmentsCount).toBe(1);
    expect(ev.includedTransactionCount).toBe(2);
  });

  it("a base (média) usa o mesmo critério da meta", () => {
    const sep = [
      card({ id: "s-old", amount: 500, competence_date: "2026-09-01", occurred_at: "2026-06-20", installment_number: 4, installments_total: 6 }),
      card({ id: "s-new", amount: 200, competence_date: "2026-09-01", occurred_at: "2026-09-12" }),
    ];
    expect(computeCategoryBaseline(sep, CAT, "prev_month", today)).toBe(200);
  });
});

describe("livro de submetas", () => {
  it("parcela de compra anterior não entra no livro de gasto", () => {
    const ledger = buildSpendingLedger([
      card({ id: "old", amount: 100, occurred_at: "2026-07-20", purchase_date: "2026-07-20", installment_number: 2, installments_total: 3 }),
      card({ id: "new", amount: 50 }),
    ]);
    expect(ledger.map((e) => e.id)).toEqual(["new"]);
  });
});
