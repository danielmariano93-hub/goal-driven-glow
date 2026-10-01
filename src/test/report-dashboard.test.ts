import { describe, expect, it } from "vitest";
import {
  buildReportDashboard, comparisonRange, granularityFor, periodTitle, type DashEntry,
} from "@/lib/engine/reportDashboard";

const out = (date: string, amount: number, category: string, merchant: string | null = null): DashEntry => ({
  date, kind: "expense", amount, category_id: `c-${category}`, category,
  merchant_key: merchant ? merchant.toLowerCase() : null, merchant,
});
const inc = (date: string, amount: number): DashEntry => ({ date, kind: "income", amount, category_id: "c-Salário", category: "Salário", merchant_key: null, merchant: null });

describe("período de comparação", () => {
  const r = (start: string, end: string) => ({ start, end, days: Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1 });
  it("mês em andamento compara com os mesmos dias do mês passado", () => {
    expect(comparisonRange(r("2026-10-01", "2026-10-15"), "previous")).toMatchObject({ start: "2026-09-01", end: "2026-09-15", days: 15 });
  });
  it("mês fechado compara com o mês anterior inteiro (inclusive em meses de tamanhos diferentes)", () => {
    expect(comparisonRange(r("2026-03-01", "2026-03-31"), "previous")).toMatchObject({ start: "2026-02-01", end: "2026-02-28" });
    expect(comparisonRange(r("2026-07-01", "2026-09-30"), "previous")).toMatchObject({ start: "2026-04-01", end: "2026-06-30" });
  });
  it("período solto compara com os dias imediatamente anteriores e 'ano' recua 12 meses", () => {
    expect(comparisonRange(r("2026-10-10", "2026-10-16"), "previous")).toMatchObject({ start: "2026-10-03", end: "2026-10-09", days: 7 });
    expect(comparisonRange(r("2026-10-01", "2026-10-31"), "year")).toMatchObject({ start: "2025-10-01", end: "2025-10-31" });
    expect(comparisonRange(r("2026-10-01", "2026-10-31"), "none")).toBeNull();
  });
  it("granularidade automática e rótulo do período", () => {
    expect([granularityFor(31), granularityFor(90), granularityFor(365)]).toEqual(["day", "week", "month"]);
    expect(periodTitle({ start: "2026-10-01", end: "2026-10-31", days: 31 })).toBe("outubro de 2026");
    expect(periodTitle({ start: "2026-10-03", end: "2026-10-09", days: 7 })).toBe("03/10 a 09/10");
  });
});

describe("painel: totais, variação e para onde vai o dinheiro", () => {
  const entries: DashEntry[] = [
    // setembro (anterior)
    inc("2026-09-05", 10000), out("2026-09-06", 3000, "Moradia", "LS Prado"), out("2026-09-08", 800, "Mercado", "Extra"),
    out("2026-09-10", 500, "Lazer", "Bar"), out("2026-09-12", 600, "Transporte", "Uber"), out("2026-09-14", 100, "Assinaturas", "Netflix"),
    // outubro até o dia 15
    inc("2026-10-05", 10000), out("2026-10-06", 3000, "Moradia", "LS Prado"), out("2026-10-08", 800, "Mercado", "Extra"),
    out("2026-10-09", 1500, "Lazer", "Ingresse"), out("2026-10-10", 200, "Lazer", "Bar"),
    out("2026-10-11", 600, "Transporte", "Uber"), out("2026-10-12", 400, "Transporte", "99"), out("2026-10-13", 100, "Assinaturas", "Netflix"),
    out("2026-10-14", 30, "Alimentação", "Padaria"),
  ];
  const d = buildReportDashboard(entries, { today: "2026-10-15", start: "2026-10-01", end: "2026-10-15", compare: "previous" });

  it("totais com variação sobre os mesmos dias do mês passado", () => {
    expect(d.previous).toMatchObject({ start: "2026-09-01", end: "2026-09-15" });
    expect(d.totals).toMatchObject({ income: 10000, expense: 6630, net: 3370, savingsRate: 0.34 });
    expect(d.previousTotals).toMatchObject({ expense: 5000, net: 5000, savingsRate: 0.5 });
    expect(d.deltas?.expense).toEqual({ abs: 1630, pct: 0.33 });
    expect(d.deltas?.savingsRatePoints).toBe(-16);
    expect(d.totals.dailyAvg).toBeCloseTo(442, 0);
  });

  it("categorias com participação no todo e estabelecimentos dentro", () => {
    const lazer = d.categories.find((c) => c.name === "Lazer")!;
    expect(lazer).toMatchObject({ total: 1700, previous: 500, deltaAbs: 1200, deltaPct: 2.4 });
    expect(lazer.share).toBeCloseTo(1700 / 6630, 2);
    expect(lazer.merchants.map((m) => [m.label, m.share])).toEqual([["Ingresse", 0.88], ["Bar", 0.12]]);
    expect(lazer.spark).toHaveLength(6);
    expect(d.categories.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 1);
  });

  it("cascata explica a variação do gasto", () => {
    expect(d.change?.ups[0]).toEqual({ name: "Lazer", delta: 1200 });
    const shown = (d.change?.ups ?? []).reduce((a, m) => a + m.delta, 0) + (d.change?.downs ?? []).reduce((a, m) => a + m.delta, 0);
    expect(shown + (d.change?.other ?? 0)).toBeCloseTo(1630, 1);
  });

  it("veredito explícito: pior, com os sinais que explicam", () => {
    expect(d.verdict?.kind).toBe("worse");
    expect(d.verdict?.headline).toBe("Você está pior que no período anterior");
    const keys = d.verdict?.signals.filter((s) => s.points < 0).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["savings", "categories"]));
  });

  it("destaques acionáveis e projeção do mês em andamento", () => {
    expect(d.highlights[0].title).toContain("Lazer subiu");
    expect(d.highlights[0].action?.label).toBe("Criar meta de Lazer");
    expect(d.projection).toMatchObject({ daysElapsed: 15, daysInMonth: 31 });
    expect(d.projection?.expense).toBeCloseTo(6630 / 15 * 31, 0);
  });

  it("série diária alinhada ao período anterior", () => {
    expect(d.granularity).toBe("day");
    expect(d.series).toHaveLength(15);
    expect(d.series[8]).toMatchObject({ expense: 1500, previousExpense: 0 });
    expect(d.series[5].previousExpense).toBe(3000);
  });
});

describe("painel: veredito melhor, igual, insuficiente e filtros", () => {
  const base = (cur: number, prev: number): DashEntry[] => [
    inc("2026-08-05", 8000), out("2026-08-10", prev, "Lazer", "Bar"), out("2026-08-12", 1000, "Moradia", "Aluguel"),
    ...Array.from({ length: 5 }, (_, i) => out(`2026-08-${String(15 + i).padStart(2, "0")}`, 20, "Alimentação", "Padaria")),
    inc("2026-09-05", 8000), out("2026-09-10", cur, "Lazer", "Bar"), out("2026-09-12", 1000, "Moradia", "Aluguel"),
    ...Array.from({ length: 5 }, (_, i) => out(`2026-09-${String(15 + i).padStart(2, "0")}`, 20, "Alimentação", "Padaria")),
  ];
  const run = (entries: DashEntry[]) => buildReportDashboard(entries, { today: "2026-10-02", start: "2026-09-01", end: "2026-09-30", compare: "previous" });

  it("melhor quando poupa mais e o gasto flexível cai", () => {
    const d = run(base(500, 2000));
    expect(d.verdict?.kind).toBe("better");
    expect(d.habits.find((h) => h.key === "flexible")?.direction).toBe("better");
  });
  it("igual quando nada mudou", () => {
    expect(run(base(1000, 1000)).verdict?.kind).toBe("same");
  });
  it("insuficiente sem período anterior com dados ou sem comparação", () => {
    expect(run([inc("2026-09-05", 5000), out("2026-09-06", 100, "Lazer")]).verdict?.kind).toBe("insufficient");
    const none = buildReportDashboard(base(500, 2000), { today: "2026-10-02", start: "2026-09-01", end: "2026-09-30", compare: "none" });
    expect(none.verdict?.kind).toBe("insufficient");
    expect(none.previous).toBeNull();
  });
  it("filtro por categoria e estabelecimento calcula só despesa e não dá veredito", () => {
    const d = buildReportDashboard(base(500, 2000), { today: "2026-10-02", start: "2026-09-01", end: "2026-09-30", compare: "previous", categoryIds: ["c-Lazer"] });
    expect(d.filtered).toBe(true);
    expect(d.verdict).toBeNull();
    expect(d.totals).toMatchObject({ income: 0, expense: 500 });
    expect(d.filterOptions.categories.map((c) => c.name)).toContain("Moradia");
    const m = buildReportDashboard(base(500, 2000), { today: "2026-10-02", start: "2026-09-01", end: "2026-09-30", compare: "none", merchant: "padar" });
    expect(m.totals.expense).toBe(100);
    expect(m.previousTotals).toBeNull();
  });
  it("estorno abate a categoria e período vazio não quebra", () => {
    const d = run([inc("2026-09-05", 5000), out("2026-09-06", 300, "Lazer", "Bar"), out("2026-09-07", -100, "Lazer", "Bar")]);
    expect(d.categories[0].total).toBe(200);
    const empty = buildReportDashboard([], { today: "2026-10-02", start: "2026-09-01", end: "2026-09-30", compare: "previous" });
    expect(empty.totals.expense).toBe(0);
    expect(empty.categories).toEqual([]);
    expect(empty.coverage.monthsOfHistory).toBe(0);
  });
});

describe("validação do pedido no servidor", () => {
  it("normaliza, limita e recusa períodos inválidos", async () => {
    const { parseDashboardParams } = await import("../../supabase/functions/_shared/reportsDashboard/runtime");
    const ok = parseDashboardParams({ start: "2026-10-01", end: "2026-12-31", compare: "year", category_ids: ["a", 3, "b"], merchant: "  Uber  " }, "2026-10-15");
    expect(ok).toEqual({ start: "2026-10-01", end: "2026-10-15", compare: "year", categoryIds: ["a", "b"], merchant: "Uber" });
    expect(parseDashboardParams({ start: "2026-10-10", end: "2026-10-01" }, "2026-10-15")).toBe("invalid_period");
    expect(parseDashboardParams({ start: "oops", end: "2026-10-01" }, "2026-10-15")).toBe("invalid_period");
    expect(parseDashboardParams({ start: "2025-01-01", end: "2026-10-15" }, "2026-10-15")).toBe("period_too_long");
    expect(parseDashboardParams({ start: "2024-01-01", end: "2024-02-01" }, "2026-10-15")).toBe("period_too_old");
    expect((parseDashboardParams({ start: "2026-10-01", end: "2026-10-02", compare: "x" }, "2026-10-15") as { compare: string }).compare).toBe("previous");
  });
});

describe("report_dashboard.v1 – bordas encontradas com dados reais", () => {
  it("não dá veredito nem projeção nos primeiros dias do período em andamento", () => {
    const entries: DashEntry[] = [
      { date: "2026-09-10", kind: "expense", amount: 500, category_id: "c1", category: "Lazer", merchant_key: "x", merchant: "X" },
      ...Array.from({ length: 6 }, (_, i) => ({ date: `2026-09-${10 + i}`, kind: "expense" as const, amount: 50, category_id: "c1", category: "Lazer", merchant_key: "x", merchant: "X" })),
      { date: "2026-10-01", kind: "expense", amount: 10, category_id: "c1", category: "Lazer", merchant_key: "x", merchant: "X" },
    ];
    const d = buildReportDashboard(entries, { today: "2026-10-01", start: "2026-10-01", end: "2026-10-01", compare: "previous", categoryIds: [], merchant: "" });
    expect(d.verdict?.kind).toBe("insufficient");
    expect(d.projection).toBeNull();
  });
});
