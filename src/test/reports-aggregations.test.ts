import { describe, it, expect } from "vitest";
import { groupByMonth, byCategory, filterPeriod, toCsv } from "@/lib/reports/aggregations";

const txns = [
  { type: "income" as const, amount: 5000, occurred_at: "2026-01-05", category_name: "Salário" },
  { type: "expense" as const, amount: 100, occurred_at: "2026-01-10", category_name: "Mercado" },
  { type: "expense" as const, amount: 200, occurred_at: "2026-01-20", category_name: "Lazer" },
  { type: "expense" as const, amount: 150, occurred_at: "2026-02-05", category_name: "Mercado" },
  { type: "transfer" as const, amount: 500, occurred_at: "2026-01-08" },
];

describe("aggregations", () => {
  it("agrupa por mês ignorando transferências", () => {
    const r = groupByMonth(txns);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ ym: "2026-01", income: 5000, expense: 300, net: 4700 });
  });

  it("agrupa por categoria só despesas", () => {
    const r = byCategory(txns);
    expect(r[0]).toMatchObject({ category: "Mercado", total: 250 });
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
