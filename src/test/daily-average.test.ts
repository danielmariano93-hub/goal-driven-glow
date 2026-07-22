import { describe, it, expect } from "vitest";
import {
  daysInclusive,
  shiftRangePrevMonth,
  computeDailyAverage,
  computeDailyAverageComparison,
  formatRangeShort,
} from "@/lib/engine/dailyAverage";
import type { TransactionRow } from "@/lib/engine/facts";

function tx(partial: Partial<TransactionRow> & { id: string; occurred_at: string; amount: number }): TransactionRow {
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
    ...partial,
  } as TransactionRow;
}

describe("daysInclusive", () => {
  it("mesmo dia = 1", () => expect(daysInclusive("2026-07-15", "2026-07-15")).toBe(1));
  it("2 dias corridos", () => expect(daysInclusive("2026-07-10", "2026-07-11")).toBe(2));
  it("mês cheio julho", () => expect(daysInclusive("2026-07-01", "2026-07-31")).toBe(31));
  it("intervalo invertido = 0", () => expect(daysInclusive("2026-07-20", "2026-07-01")).toBe(0));
  it("cruza DST-safe (mar->abr)", () => expect(daysInclusive("2026-03-30", "2026-04-02")).toBe(4));
});

describe("shiftRangePrevMonth", () => {
  it("31 mar -> 28 fev em ano não bissexto", () => {
    expect(shiftRangePrevMonth({ start: "2026-03-01", end: "2026-03-31" }))
      .toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("29 mar -> 29 fev em ano bissexto", () => {
    expect(shiftRangePrevMonth({ start: "2024-03-01", end: "2024-03-29" }))
      .toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });
  it("cruza ano jan -> dez ano anterior", () => {
    expect(shiftRangePrevMonth({ start: "2026-01-05", end: "2026-01-20" }))
      .toEqual({ start: "2025-12-05", end: "2025-12-20" });
  });
});

describe("computeDailyAverage exclui movimentos não comportamentais", () => {
  const txs: TransactionRow[] = [
    tx({ id: "1", occurred_at: "2026-07-01", amount: 100 }),
    tx({ id: "2", occurred_at: "2026-07-02", amount: 50, type: "transfer" }),
    tx({ id: "3", occurred_at: "2026-07-03", amount: 200, movement_kind: "investment_application" }),
    tx({ id: "4", occurred_at: "2026-07-04", amount: 300, settles_card_id: "c1" }),
    tx({ id: "5", occurred_at: "2026-07-05", amount: 60 }),
    tx({ id: "6", occurred_at: "2026-07-06", amount: 20, movement_kind: "refund" }),
    tx({ id: "7", occurred_at: "2026-06-30", amount: 999 }), // fora do range
  ];

  it("ignora transfer, investment, settles_card_id; refund abate", () => {
    const r = computeDailyAverage(txs, { start: "2026-07-01", end: "2026-07-10" });
    expect(r.total).toBe(140); // 100 + 60 - 20
    expect(r.days).toBe(10);
    expect(r.avg).toBe(14);
  });

  it("range de 1 dia sem despesas => avg 0", () => {
    const r = computeDailyAverage([], { start: "2026-07-01", end: "2026-07-01" });
    expect(r).toEqual({ total: 0, days: 1, avg: 0 });
  });

  it("range invertido => days 0 sem NaN", () => {
    const r = computeDailyAverage(txs, { start: "2026-07-10", end: "2026-07-01" });
    expect(r).toEqual({ total: 0, days: 0, avg: 0 });
  });
});

describe("computeDailyAverageComparison", () => {
  const txs: TransactionRow[] = [
    tx({ id: "cur", occurred_at: "2026-07-05", amount: 300 }),
    tx({ id: "prev", occurred_at: "2026-06-05", amount: 150 }),
  ];
  const range = { start: "2026-07-01", end: "2026-07-10" };

  it("alta ~100% vira trend 'up'", () => {
    const c = computeDailyAverageComparison(txs, range);
    expect(c.trend).toBe("up");
    expect(c.deltaPct).toBe(100);
    expect(c.prevRange).toEqual({ start: "2026-06-01", end: "2026-06-10" });
  });

  it("previous=0 e current=0 => stable, delta null", () => {
    const c = computeDailyAverageComparison([], range);
    expect(c.trend).toBe("stable");
    expect(c.deltaPct).toBeNull();
  });

  it("previous=0 e current>0 => trend 'up' com delta null", () => {
    const c = computeDailyAverageComparison([tx({ id: "x", occurred_at: "2026-07-05", amount: 100 })], range);
    expect(c.trend).toBe("up");
    expect(c.deltaPct).toBeNull();
  });

  it("variação <1% => stable", () => {
    const near: TransactionRow[] = [
      tx({ id: "cur", occurred_at: "2026-07-05", amount: 1000 }),
      tx({ id: "prev", occurred_at: "2026-06-05", amount: 1005 }),
    ];
    const c = computeDailyAverageComparison(near, range);
    expect(c.trend).toBe("stable");
  });

  it("queda vira trend 'down'", () => {
    const dn: TransactionRow[] = [
      tx({ id: "cur", occurred_at: "2026-07-05", amount: 100 }),
      tx({ id: "prev", occurred_at: "2026-06-05", amount: 400 }),
    ];
    const c = computeDailyAverageComparison(dn, range);
    expect(c.trend).toBe("down");
    expect(c.deltaPct).toBe(-75);
  });
});

describe("formatRangeShort", () => {
  it("mesmo mês", () => expect(formatRangeShort({ start: "2026-06-01", end: "2026-06-21" })).toBe("1–21 jun."));
  it("mesmo dia", () => expect(formatRangeShort({ start: "2026-06-05", end: "2026-06-05" })).toBe("5 jun."));
  it("cruza meses", () => expect(formatRangeShort({ start: "2026-02-28", end: "2026-03-03" })).toBe("28 fev. – 3 mar."));
});
