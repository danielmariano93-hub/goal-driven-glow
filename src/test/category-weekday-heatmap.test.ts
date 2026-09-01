import { describe, expect, it } from "vitest";
import {
  computeCategoryWeekdayHeatmap,
  countWeekdayOccurrences,
  weekdayKeyOf,
  type HeatmapTransactionRow,
} from "@/lib/engine/categoryWeekdayHeatmap";
import type { CategoryRow } from "@/lib/engine/facts";

const RANGE = { start: "2026-06-04", end: "2026-09-01" }; // 90 dias

const CATEGORIES = [
  { id: "cat-lazer", name: "Lazer" },
  { id: "cat-transp", name: "Transporte" },
  { id: "cat-mercado", name: "Mercado" },
] as unknown as CategoryRow[];

function tx(over: Partial<HeatmapTransactionRow> & { id: string; occurred_at: string; amount: number }): HeatmapTransactionRow {
  return {
    account_id: "acc-1",
    category_id: "cat-lazer",
    type: "expense",
    status: "confirmed",
    description: null,
    transfer_group_id: null,
    movement_kind: "transaction",
    ...over,
  } as HeatmapTransactionRow;
}

function run(transactions: HeatmapTransactionRow[], range = RANGE) {
  return computeCategoryWeekdayHeatmap({ transactions, categories: CATEGORIES, range, timezone: "America/Sao_Paulo" });
}

const cellOf = (result: ReturnType<typeof run>, categoryId: string, weekday: string) =>
  result.categories.find((c) => c.categoryId === categoryId)!.cells.find((c) => c.weekday === weekday)!;

describe("category_weekday_heatmap.v1", () => {
  it("TESTE 1 — compra de cartão de sábado com competência no mês seguinte cai em sábado", () => {
    const result = run([
      tx({ id: "t1", occurred_at: "2026-07-25", amount: 200, competence_date: "2026-08-01", payment_method: "credit_card", credit_card_id: "card-1" }),
    ]);
    expect(weekdayKeyOf("2026-07-25")).toBe("saturday");
    expect(cellOf(result, "cat-lazer", "saturday").total).toBe(200);
    expect(cellOf(result, "cat-lazer", "friday").total).toBe(0);
  });

  it("TESTE 2 — média divide pelas ocorrências reais do sábado, não pelos dias com gasto", () => {
    const saturdays = ["2026-06-06", "2026-06-13", "2026-06-20"];
    const result = run(saturdays.map((d, i) => tx({ id: `s${i}`, occurred_at: d, amount: 1300 / 3 })));
    const occurrences = result.weekdayOccurrences.saturday;
    expect(occurrences).toBe(13);
    const cell = cellOf(result, "cat-lazer", "saturday");
    expect(cell.total).toBe(1300);
    expect(cell.average).toBe(100);
  });

  it("TESTE 3 — estorno abate a categoria original", () => {
    const result = run([
      tx({ id: "orig", occurred_at: "2026-06-06", amount: 100, category_id: "cat-transp" }),
      tx({ id: "ref", occurred_at: "2026-06-06", amount: 30, category_id: null, type: "income", movement_kind: "refund", refund_of_transaction_id: "orig" }),
    ]);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].categoryId).toBe("cat-transp");
    expect(cellOf(result, "cat-transp", "saturday").total).toBe(70);
  });

  it("TESTE 4 — pagamento de fatura não entra", () => {
    const result = run([tx({ id: "bill", occurred_at: "2026-06-10", amount: 900, settles_card_id: "card-1" })]);
    expect(result.categories).toHaveLength(0);
  });

  it("TESTE 5 — aplicação de investimento não entra", () => {
    const result = run([tx({ id: "inv", occurred_at: "2026-06-10", amount: 500, movement_kind: "investment_contribution", investment_id: "inv-1" })]);
    expect(result.categories).toHaveLength(0);
  });

  it("TESTE 6 — transferência interna não entra", () => {
    const result = run([tx({ id: "tr", occurred_at: "2026-06-10", amount: 500, type: "transfer", transfer_group_id: "g1", movement_kind: "internal_transfer_out" })]);
    expect(result.categories).toHaveLength(0);
  });

  it("TESTE 7 — lançamento superseded não entra", () => {
    const result = run([tx({ id: "sup", occurred_at: "2026-06-10", amount: 500, status: "superseded" as never })]);
    expect(result.categories).toHaveLength(0);
  });

  it("TESTE 8 — normalização por linha 0,25 / 0,50 / 1,00", () => {
    const result = run([
      tx({ id: "m", occurred_at: "2026-06-08", amount: 50 }),
      tx({ id: "t", occurred_at: "2026-06-09", amount: 100 }),
      tx({ id: "w", occurred_at: "2026-06-10", amount: 200 }),
    ]);
    expect(cellOf(result, "cat-lazer", "monday").intensity).toBeCloseTo(0.25, 5);
    expect(cellOf(result, "cat-lazer", "tuesday").intensity).toBeCloseTo(0.5, 5);
    expect(cellOf(result, "cat-lazer", "wednesday").intensity).toBeCloseTo(1, 5);
  });

  it("TESTE 9 — categoria grande e pequena normalizam a própria linha", () => {
    const result = run([
      tx({ id: "big1", occurred_at: "2026-06-06", amount: 2000, category_id: "cat-lazer" }),
      tx({ id: "big2", occurred_at: "2026-06-08", amount: 500, category_id: "cat-lazer" }),
      tx({ id: "small1", occurred_at: "2026-06-06", amount: 300, category_id: "cat-transp" }),
      tx({ id: "small2", occurred_at: "2026-06-08", amount: 75, category_id: "cat-transp" }),
    ]);
    expect(cellOf(result, "cat-lazer", "saturday").intensity).toBeCloseTo(1, 5);
    expect(cellOf(result, "cat-transp", "saturday").intensity).toBeCloseTo(1, 5);
    expect(cellOf(result, "cat-transp", "monday").intensity).toBeCloseTo(0.25, 5);
  });

  it("TESTE 10 — dias sem gasto contam no denominador", () => {
    const occurrences = countWeekdayOccurrences(RANGE.start, RANGE.end);
    const result = run([tx({ id: "one", occurred_at: "2026-06-06", amount: 1300 })]);
    expect(cellOf(result, "cat-lazer", "saturday").average).toBeCloseTo(1300 / occurrences.saturday, 5);
  });

  it("TESTE 11 — timezone America/Sao_Paulo não desloca o dia da semana", () => {
    expect(weekdayKeyOf("2026-08-31")).toBe("monday");
    expect(weekdayKeyOf("2026-09-01")).toBe("tuesday");
    const result = run([tx({ id: "late", occurred_at: "2026-08-31", amount: 90, occurred_at_time: "23:45" } as never)]);
    expect(cellOf(result, "cat-lazer", "monday").total).toBe(90);
  });

  it("TESTE 12 — menos de 28 dias com histórico útil marca sufficientHistory=false", () => {
    const result = run([
      tx({ id: "a", occurred_at: "2026-06-06", amount: 100 }),
      tx({ id: "b", occurred_at: "2026-06-07", amount: 100 }),
    ]);
    expect(result.dataQuality.observedDays).toBe(2);
    expect(result.dataQuality.sufficientHistory).toBe(false);
    expect(result.insight).toBeNull();
  });

  it("usa behavioral_day confiável e ignora quando a confiança é baixa", () => {
    const confident = run([tx({ id: "c1", occurred_at: "2026-06-08", behavioral_day: "2026-06-06", behavior_date_confidence: 0.9, amount: 100 })]);
    expect(cellOf(confident, "cat-lazer", "saturday").total).toBe(100);
    const weak = run([tx({ id: "c2", occurred_at: "2026-06-08", behavioral_day: "2026-06-06", behavior_date_confidence: 0.2, amount: 100 })]);
    expect(cellOf(weak, "cat-lazer", "monday").total).toBe(100);
  });

  it("gera insight determinístico só com padrão forte e materialidade", () => {
    const weekend: HeatmapTransactionRow[] = [];
    for (let i = 0; i < 13; i += 1) {
      const day = new Date(Date.parse("2026-06-06T12:00:00Z") + i * 7 * 86400000).toISOString().slice(0, 10);
      if (day > RANGE.end) break;
      weekend.push(tx({ id: `w${i}`, occurred_at: day, amount: 300 }));
    }
    for (let i = 0; i < 30; i += 1) {
      const day = new Date(Date.parse("2026-06-04T12:00:00Z") + i * 86400000).toISOString().slice(0, 10);
      weekend.push(tx({ id: `d${i}`, occurred_at: day, amount: 5, category_id: "cat-mercado" }));
    }
    const result = computeCategoryWeekdayHeatmap({ transactions: weekend, categories: CATEGORIES, range: RANGE });
    expect(result.dataQuality.sufficientHistory).toBe(true);
    expect(result.insight?.categoryId).toBe("cat-lazer");
    expect(result.insight?.text).toContain("Lazer");
  });
});
