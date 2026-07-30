import { describe, expect, it } from "vitest";
import { buildDailySpendSeries, resolveDebtPlan } from "@/lib/finance/accounting";
import type { TransactionRow } from "@/lib/engine/facts";

const tx = (id: string, date: string, amount: number, extra: Partial<TransactionRow> = {}): TransactionRow => ({
  id,
  account_id: "account",
  category_id: "category",
  type: "expense",
  status: "confirmed",
  amount,
  occurred_at: date,
  description: id,
  transfer_group_id: null,
  movement_kind: "transaction",
  ...extra,
});

describe("accounting core", () => {
  it("infere total, pago, saldo e progresso de uma dívida parcelada", () => {
    expect(resolveDebtPlan({
      installmentAmount: 250,
      installmentsTotal: 12,
      installmentsPaid: 4,
    })).toEqual({
      originalAmount: 3000,
      installmentAmount: 250,
      installmentsTotal: 12,
      installmentsPaid: 4,
      paidAmount: 1000,
      outstandingAmount: 2000,
      progressPct: 33.33,
      inferredOriginal: true,
    });
  });

  it("limita parcelas pagas ao total e nunca cria saldo negativo", () => {
    const plan = resolveDebtPlan({
      originalAmount: 1000,
      installmentAmount: 100,
      installmentsTotal: 10,
      installmentsPaid: 15,
    });
    expect(plan.installmentsPaid).toBe(10);
    expect(plan.outstandingAmount).toBe(0);
    expect(plan.progressPct).toBe(100);
  });

  it("inclui dias zerados e exclui pagamento de fatura da série diária", () => {
    const series = buildDailySpendSeries([
      tx("meal", "2026-07-01", 90),
      tx("bill", "2026-07-02", 900, {
        settles_card_id: "card",
        movement_kind: "credit_card_bill_payment",
      }),
    ], { start: "2026-07-01", end: "2026-07-03" });
    expect(series.map((point) => point.actual)).toEqual([90, 0, 0]);
    expect(series[2].rollingTypical).toBe(30);
  });
});
