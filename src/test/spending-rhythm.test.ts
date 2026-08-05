import { describe, it, expect } from "vitest";
import {
  computeRhythm,
  computeRhythmComparison,
  previousComparableRange,
  clampRangeToToday,
  daysInclusive,
} from "@/lib/engine/spendingRhythm";
import type { RhythmTx } from "@/lib/engine/spendingRhythm";

function tx(p: Partial<RhythmTx> & { id: string; occurred_at: string; amount: number }): RhythmTx {
  return {
    account_id: "a1",
    category_id: null,
    type: "expense",
    status: "confirmed",
    description: null,
    transfer_group_id: null,
    payment_method: "account",
    credit_card_id: null,
    settles_card_id: null,
    movement_kind: "transaction",
    ...p,
  } as RhythmTx;
}

const RANGE = { start: "2026-07-01", end: "2026-07-10" };

describe("período anterior comparável", () => {
  it("tem exatamente o mesmo número de dias", () => {
    const prev = previousComparableRange(RANGE);
    expect(prev).toEqual({ start: "2026-06-21", end: "2026-06-30" });
    expect(daysInclusive(prev.start, prev.end)).toBe(daysInclusive(RANGE.start, RANGE.end));
  });
  it("alinha mês até hoje aos mesmos dias do mês anterior", () => {
    expect(previousComparableRange({ start: "2026-08-01", end: "2026-08-05" }))
      .toEqual({ start: "2026-07-01", end: "2026-07-05" });
  });
  it("alinha fim de mês ao último dia válido do mês anterior", () => {
    expect(previousComparableRange({ start: "2026-03-01", end: "2026-03-31" }))
      .toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("janela de 30 dias mantém 30 dias mesmo cruzando fevereiro", () => {
    const r = { start: "2026-03-02", end: "2026-03-31" };
    const prev = previousComparableRange(r);
    expect(daysInclusive(prev.start, prev.end)).toBe(30);
    expect(prev.end).toBe("2026-03-01");
  });
});

describe("clampRangeToToday", () => {
  it("nunca projeta dias futuros", () => {
    expect(clampRangeToToday({ start: "2026-07-01", end: "2026-07-31" }, "2026-07-10").end).toBe("2026-07-10");
  });
});

describe("média total x ritmo típico", () => {
  const txs: RhythmTx[] = [
    tx({ id: "aluguel", occurred_at: "2026-07-05", amount: 2000, category_id: "cat-moradia" }),
    tx({ id: "d1", occurred_at: "2026-07-01", amount: 50 }),
    tx({ id: "d2", occurred_at: "2026-07-02", amount: 60 }),
    tx({ id: "d3", occurred_at: "2026-07-03", amount: 40 }),
    tx({ id: "d4", occurred_at: "2026-07-04", amount: 55 }),
    tx({ id: "d5", occurred_at: "2026-07-06", amount: 45 }),
    tx({ id: "d6", occurred_at: "2026-07-07", amount: 65 }),
    tx({ id: "d7", occurred_at: "2026-07-08", amount: 50 }),
    tx({ id: "d8", occurred_at: "2026-07-09", amount: 900 }), // outlier
    tx({ id: "fatura", occurred_at: "2026-07-09", amount: 3000, settles_card_id: "c1" }),
    tx({ id: "invest", occurred_at: "2026-07-09", amount: 500, movement_kind: "investment_application" }),
    tx({ id: "transf", occurred_at: "2026-07-09", amount: 700, type: "transfer" }),
  ];
  const opts = { categoryNameById: { "cat-moradia": "Moradia" } };

  it("ignora fatura, investimento e transferência", () => {
    const r = computeRhythm(txs, RANGE, opts);
    expect(r.total).toBe(3265); // 2000 + 365 + 900
    expect(r.days).toBe(10);
    expect(r.average).toBe(326.5);
  });

  it("ritmo típico remove fixa e outlier", () => {
    const r = computeRhythm(txs, RANGE, opts);
    const reasons = r.excluded.map((e) => e.reason).sort();
    expect(reasons).toEqual(["fixed", "outlier"]);
    expect(r.typicalTotal).toBe(365);
    expect(r.typicalAverage).toBe(36.5);
  });

  it("dias sem gasto entram no denominador", () => {
    const r = computeRhythm([tx({ id: "x", occurred_at: "2026-07-01", amount: 100 })], RANGE);
    expect(r.average).toBe(10);
    expect(r.series).toHaveLength(10);
    expect(r.series[9].cumulative).toBe(100);
    expect(r.series[9].runningAverage).toBe(10);
  });

  it("compra no cartão conta no dia da compra", () => {
    const r = computeRhythm(
      [tx({ id: "c", occurred_at: "2026-07-02", amount: 120, payment_method: "credit_card", credit_card_id: "c1" })],
      RANGE,
    );
    expect(r.series[1].amount).toBe(120);
    expect(r.total).toBe(120);
  });

  it("amostra pequena não gera outlier", () => {
    const r = computeRhythm(
      [tx({ id: "a", occurred_at: "2026-07-01", amount: 10 }), tx({ id: "b", occurred_at: "2026-07-02", amount: 900 })],
      RANGE,
    );
    expect(r.excluded).toHaveLength(0);
    expect(r.typicalTotal).toBe(910);
  });
});

describe("comparação de ritmo", () => {
  it("queda no ritmo típico vira tendência de baixa", () => {
    const txs: RhythmTx[] = [
      tx({ id: "p1", occurred_at: "2026-06-25", amount: 400 }),
      tx({ id: "c1", occurred_at: "2026-07-05", amount: 100 }),
    ];
    const c = computeRhythmComparison(txs, RANGE);
    expect(c.previous.range).toEqual({ start: "2026-06-21", end: "2026-06-30" });
    expect(c.typicalTrend).toBe("down");
    expect(c.typicalDeltaPct).toBe(-75);
  });

  it("sem base anterior retorna delta nulo", () => {
    const c = computeRhythmComparison([tx({ id: "c1", occurred_at: "2026-07-05", amount: 100 })], RANGE);
    expect(c.typicalDeltaPct).toBeNull();
    expect(c.typicalTrend).toBe("up");
  });
});
