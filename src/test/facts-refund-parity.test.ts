import { describe, it, expect } from "vitest";
import {
  behavioralMetricAmount,
  computeMonthlyTotals,
  isRealMonthlyMovement,
  FORMULA_VERSION,
} from "@/lib/engine/facts";

// Paridade TS ↔ SQL (`is_behavioral_consumption` + refresh_financial_daily_facts):
// - refund abate consumo apenas quando type='income' e transfer_group_id IS NULL;
// - refund lançado como expense é dado inconsistente e retorna 0;
// - transfer_group_id != null exclui a linha do consumo real;
// - internal_transfer e settles_card_id continuam fora;
// - kinds patrimoniais e loan_proceeds continuam fora.

const base = {
  id: "t",
  account_id: "a1",
  category_id: null,
  description: null,
  transfer_group_id: null,
  credit_card_id: null,
  settles_card_id: null,
  payment_method: "account",
} as const;

describe("paridade TS ↔ SQL (financial_daily.v2)", () => {
  it("exporta FORMULA_VERSION casando com o SQL", () => {
    expect(FORMULA_VERSION).toBe("financial_daily.v2");
  });

  it("refund income com transfer_group_id=null abate consumo", () => {
    const tx = { ...base, type: "income", status: "confirmed", movement_kind: "refund", amount: 50, occurred_at: "2026-07-11" } as any;
    expect(behavioralMetricAmount(tx, "expense")).toBe(-50);
    expect(behavioralMetricAmount(tx, "income")).toBe(0);
  });

  it("refund lançado como expense NÃO abate (dado inconsistente)", () => {
    const tx = { ...base, type: "expense", status: "confirmed", movement_kind: "refund", amount: 80, occurred_at: "2026-07-12" } as any;
    expect(behavioralMetricAmount(tx, "expense")).toBe(0);
    expect(behavioralMetricAmount(tx, "income")).toBe(0);
    expect(isRealMonthlyMovement(tx)).toBe(false);
  });

  it("refund com transfer_group_id preenchido é ignorado", () => {
    const tx = { ...base, type: "income", status: "confirmed", movement_kind: "refund", transfer_group_id: "g1", amount: 100, occurred_at: "2026-07-13" } as any;
    expect(behavioralMetricAmount(tx, "expense")).toBe(0);
  });

  it("transaction com transfer_group_id preenchido NÃO entra no consumo real", () => {
    const tx = { ...base, type: "expense", status: "confirmed", movement_kind: "transaction", transfer_group_id: "g2", amount: 200, occurred_at: "2026-07-14" } as any;
    expect(isRealMonthlyMovement(tx)).toBe(false);
    expect(behavioralMetricAmount(tx, "expense")).toBe(0);
  });

  it("internal_transfer, settles_card_id e patrimoniais ficam fora", () => {
    for (const mk of ["internal_transfer", "investment_application", "investment_redemption", "investment_yield", "loan_proceeds"]) {
      const tx = { ...base, type: "expense", status: "confirmed", movement_kind: mk, amount: 500, occurred_at: "2026-07-15" } as any;
      expect(behavioralMetricAmount(tx, "expense")).toBe(0);
    }
    const bill = { ...base, type: "expense", status: "confirmed", movement_kind: "transaction", settles_card_id: "c1", amount: 800, occurred_at: "2026-07-20" } as any;
    expect(behavioralMetricAmount(bill, "expense")).toBe(0);
  });

  it("cenário composto: totais mensais batem", () => {
    const month = "2026-07";
    const txs: any[] = [
      { ...base, id: "1", type: "income", status: "confirmed", movement_kind: "transaction", amount: 5000, occurred_at: "2026-07-05" },
      { ...base, id: "2", type: "expense", status: "confirmed", movement_kind: "transaction", amount: 300, occurred_at: "2026-07-10" },
      { ...base, id: "3", type: "income", status: "confirmed", movement_kind: "refund", amount: 50, occurred_at: "2026-07-11" },
      { ...base, id: "4", type: "expense", status: "confirmed", movement_kind: "investment_application", amount: 1000, occurred_at: "2026-07-12" },
      { ...base, id: "5", type: "income", status: "confirmed", movement_kind: "investment_yield", amount: 42.5, occurred_at: "2026-07-14" },
      { ...base, id: "6", type: "expense", status: "confirmed", movement_kind: "transaction", settles_card_id: "c1", amount: 800, occurred_at: "2026-07-20" },
      { ...base, id: "7", type: "transfer", status: "confirmed", movement_kind: "transaction", transfer_group_id: "g1", amount: 400, occurred_at: "2026-07-22" },
      { ...base, id: "8", type: "expense", status: "planned", movement_kind: "transaction", amount: 999, occurred_at: "2026-07-28" },
    ];
    const totals = computeMonthlyTotals(txs, month);
    // expense = 300 - 50 = 250 ; income = 5000 (yield/investment/refund fora)
    expect(totals.expense).toBe(250);
    expect(totals.income).toBe(5000);
    expect(totals.net).toBe(4750);
  });
});
