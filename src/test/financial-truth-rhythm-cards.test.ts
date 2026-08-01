import { describe, expect, it } from "vitest";
import { computeRhythm } from "@/lib/engine/spendingRhythm";
import { computeCardExposure, totalCardDebtOf } from "@/lib/engine/cardExposure";

const tx = (over: Partial<Record<string, unknown>>) => ({
  id: Math.random().toString(36).slice(2),
  account_id: "acc",
  category_id: null,
  type: "expense",
  status: "confirmed",
  amount: 100,
  occurred_at: "2026-07-10",
  description: "Compra",
  transfer_group_id: null,
  ...over,
}) as never;

describe("Verdade financeira única — ritmo bruto/líquido", () => {
  const range = { start: "2026-07-01", end: "2026-07-31" };

  it("não zera dias com estorno maior que a despesa", () => {
    const r = computeRhythm(
      [tx({ amount: 52.17, occurred_at: "2026-07-31" }), tx({ amount: 100, type: "income", occurred_at: "2026-07-31" })],
      range,
    );
    const day = r.series.find((p) => p.date === "2026-07-31")!;
    expect(day.grossAmount).toBe(52.17);
    expect(day.refundAmount).toBe(100);
    expect(day.netAmount).toBeCloseTo(-47.83, 2);
  });

  it("reconcilia bruto − estornos = líquido, e a série soma o total", () => {
    const r = computeRhythm(
      [
        tx({ amount: 200, occurred_at: "2026-07-05" }),
        tx({ amount: 50, occurred_at: "2026-07-06" }),
        tx({ amount: 30, type: "income", occurred_at: "2026-07-07" }),
      ],
      range,
    );
    expect(r.totalGross).toBe(250);
    expect(r.totalRefunds).toBe(30);
    expect(r.total).toBe(220);
    const sumNet = r.series.reduce((a, p) => a + p.netAmount, 0);
    expect(Number(sumNet.toFixed(2))).toBe(r.total);
    expect(r.series.at(-1)!.cumulative).toBe(r.total);
    expect(r.average).toBeCloseTo(220 / r.days, 2);
  });
});

describe("Verdade financeira única — exposição de cartão", () => {
  it("fatura oficial tem precedência sobre a estimativa por lançamentos", () => {
    const exposures = computeCardExposure({
      cardIds: ["card-1"],
      statements: [
        { credit_card_id: "card-1", competence_month: "2026-07-01", stated_total: 4099.34, paid_amount: 0, outstanding_amount: 4099.34, status: "open" },
      ],
      installments: [],
      txs: [{ credit_card_id: "card-1", competence_date: "2026-07-01", amount: 82.61, type: "expense", status: "confirmed" }],
      currentYM: "2026-07",
    });
    expect(exposures["card-1"].currentStatement.amount).toBe(4099.34);
    expect(exposures["card-1"].currentStatement.source).toBe("official");
    expect(totalCardDebtOf(exposures)).toBe(4099.34);
  });

  it("fatura paga zera a obrigação e as parcelas já absorvidas", () => {
    const exposures = computeCardExposure({
      cardIds: ["card-1"],
      statements: [
        { credit_card_id: "card-1", competence_month: "2026-07-01", stated_total: 1000, paid_amount: 1000, outstanding_amount: 0, status: "paid" },
      ],
      installments: [
        { credit_card_id: "card-1", competence_month: "2026-07-01", amount: 300, status: "open" },
        { credit_card_id: "card-1", competence_month: "2026-09-01", amount: 300, status: "open" },
      ],
      txs: [],
      currentYM: "2026-07",
    });
    expect(exposures["card-1"].currentStatement.amount).toBe(0);
    expect(exposures["card-1"].totalCardDebt).toBe(0);
    expect(exposures["card-1"].futureInstallments).toBe(300);
  });

  it("sem fatura oficial marca o valor como estimativa", () => {
    const exposures = computeCardExposure({
      cardIds: ["card-1"],
      statements: [],
      installments: [],
      txs: [{ credit_card_id: "card-1", competence_date: "2026-07-04", amount: 250, type: "expense", status: "confirmed" }],
      currentYM: "2026-07",
    });
    expect(exposures["card-1"].currentStatement.source).toBe("estimated");
    expect(exposures["card-1"].currentStatement.amount).toBe(250);
  });
});
