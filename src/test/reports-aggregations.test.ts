import { describe, it, expect } from "vitest";
import { groupByMonth, byCategory, filterPeriod, spendingHighlights, toCsv } from "@/lib/reports/aggregations";

const txns = [
  { type: "income" as const, status: "confirmed" as const, amount: 5000, occurred_at: "2026-01-05", category_name: "Salário" },
  { type: "expense" as const, status: "confirmed" as const, amount: 100, occurred_at: "2026-01-10", category_name: "Mercado" },
  { type: "expense" as const, status: "confirmed" as const, amount: 200, occurred_at: "2026-01-20", category_name: "Lazer" },
  { type: "expense" as const, status: "confirmed" as const, amount: 150, occurred_at: "2026-02-05", category_name: "Mercado" },
  { type: "transfer" as const, status: "confirmed" as const, amount: 500, occurred_at: "2026-01-08" },
];

describe("aggregations", () => {
  it("agrupa por mês ignorando transferências", () => {
    const r = groupByMonth(txns);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ ym: "2026-01", income: 5000, expense: 300, net: 4700 });
  });

  it("agrupa por categoria só despesas", () => {
    const r = byCategory(txns);
    expect(r[0]).toMatchObject({ category: "Mercado", total: 250, count: 2, rank: 1 });
    expect(r[0].percentOfExpenses).toBeCloseTo(55.56, 1);
    expect(r[0].average).toBe(125);
  });

  it("gera highlights acionáveis com economia calculada para categoria flexível", () => {
    const cats = byCategory([
      { type: "expense" as const, amount: 1000, occurred_at: "2026-01-05", category_name: "Lazer" },
      { type: "expense" as const, amount: 1200, occurred_at: "2026-01-06", category_name: "Moradia" },
      { type: "expense" as const, amount: 300, occurred_at: "2026-01-07", category_name: "Transporte" },
    ]);
    const h = spendingHighlights(cats);
    expect(h).toHaveLength(3);
    expect(h.some((x) => x.title.includes("Reduzir 15% em Lazer") && x.title.includes("R$ 150,00"))).toBe(true);
  });

  it("não recomenda corte percentual em categoria essencial como principal ação", () => {
    const cats = byCategory([
      { type: "expense" as const, amount: 1800, occurred_at: "2026-01-05", category_name: "Moradia" },
      { type: "expense" as const, amount: 200, occurred_at: "2026-01-06", category_name: "Saúde" },
    ]);
    const h = spendingHighlights(cats);
    expect(h[0].title).toContain("Moradia concentra");
    expect(h[0].body).toContain("renegociação");
    expect(h.map((x) => x.title).join(" ")).not.toContain("Reduzir 15% em Moradia");
  });

  it("detecta frequência relevante de gastos pequenos", () => {
    const frequent = Array.from({ length: 9 }, (_, i) => ({ type: "expense" as const, amount: 20, occurred_at: `2026-01-${String(i + 1).padStart(2, "0")}`, category_name: "Transporte" }));
    const cats = byCategory([...frequent, { type: "expense" as const, amount: 500, occurred_at: "2026-01-20", category_name: "Mercado" }]);
    const h = spendingHighlights(cats);
    expect(h.some((x) => x.title === "Transporte apareceu 9 vezes")).toBe(true);
  });

  it("filtra período", () => {
    const r = filterPeriod(txns, "2026-02-01", "2026-02-28");
    expect(r).toHaveLength(1);
  });

  it("exporta CSV", () => {
    const csv = toCsv([{ a: 1, b: "x;y" }]);
    expect(csv).toContain('"x;y"');
  });
});
