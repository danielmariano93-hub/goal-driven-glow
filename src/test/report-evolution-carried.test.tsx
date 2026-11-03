import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildReportDashboard, type DashEntry } from "@/lib/engine/reportDashboard";
import { EvolutionChart } from "@/components/reports/DashboardCharts";
import { isCarriedCardEntry, chartDateOf } from "../../supabase/functions/_shared/insights/executive/load";

const e = (id: string, date: string, amount: number, extra: Partial<DashEntry> = {}): DashEntry => ({
  id, date, kind: "expense", amount, category_id: "c", category: "Serviços", merchant_key: id, merchant: id, ...extra,
} as DashEntry);

// Caso real (3/11): fatura fecha dia 24 (futuro). Parcelas de compras de jul/set e uma compra de 27/10 entram na fatura de
// novembro: o gráfico as empurrava para "hoje" (03/11) e inventava um pico de R$ 1.183,82 num dia sem gasto.
const entries: DashEntry[] = [
  e("conta", "2026-11-01", 443.95),
  e("compra-nov", "2026-11-01", 50, { chart_date: "2026-11-02" }),
  e("jim-2", "2026-11-01", 545.13, { chart_date: "2026-11-24", chart_carried: true }),
  e("jim-4", "2026-11-01", 508.79, { chart_date: "2026-11-24", chart_carried: true }),
  e("claude", "2026-11-01", 129.9, { chart_date: "2026-11-24", chart_carried: true }),
  // fatura de outubro (período anterior): R$ 5.226 que iam para "03/10"
  e("out-conta", "2026-10-02", 100),
  e("out-fatura", "2026-10-01", 5226.2, { chart_date: "2026-10-24", chart_carried: true }),
];
const dash = (list = entries, extra = {}) => buildReportDashboard(list, { today: "2026-11-03", start: "2026-11-01", end: "2026-11-03", compare: "previous", ...extra });

describe("gráfico 'quanto saiu': parcela e compra de fatura anterior não viram pico num dia", () => {
  const d = dash();
  const day = (from: string) => d.series.find((p) => p.from === from);
  it("o total do período continua incluindo tudo (competência)", () => {
    expect(d.totals.expense).toBeCloseTo(443.95 + 50 + 545.13 + 508.79 + 129.9, 2);
  });
  it("nenhuma barra no dia 03/11, e o dia 02/11 só tem o que aconteceu nele", () => {
    expect(day("2026-11-03")!.expense).toBe(0);
    expect(day("2026-11-02")!.expense).toBe(50);
    expect(day("2026-11-01")!.expense).toBeCloseTo(443.95, 2);
  });
  it("o período anterior também não ganha pico no último dia (a linha tracejada)", () => {
    // a série anterior é alinhada por posição: 01/11↔01/10, 02/11↔02/10, 03/11↔03/10
    expect(d.series[2]!.previousExpense).toBe(0);
    expect(d.series[1]!.previousExpense).toBe(100);
  });
  it("o que ficou fora das barras é declarado, com quanto e quantos lançamentos", () => {
    expect(d.carried).toEqual({ current: 1183.82, previous: 5226.2, count: 3 });
  });
  it("a soma das barras + o declarado fecha com o total", () => {
    expect(d.series.reduce((a, p) => a + p.expense, 0) + d.carried!.current).toBeCloseTo(d.totals.expense, 2);
  });
  it("granularidade mensal: nada muda e não há nota", () => {
    const m = buildReportDashboard(entries, { today: "2026-11-30", start: "2025-11-01", end: "2026-11-30", compare: "none" });
    expect(m.carried).toBeNull();
  });
  it("sem lançamentos de fatura anterior, não há nota", () => {
    expect(dash(entries.filter((x) => !x.chart_carried)).carried).toBeNull();
  });
  it("a tela diz o que ficou fora das barras e por quê", () => {
    render(<EvolutionChart d={d} />);
    const note = screen.getByTestId("evolution-carried").textContent ?? "";
    expect(note).toMatch(/Fora das barras: R\$\s?1\.183,82 em parcelas e compras de faturas anteriores \(3 lançamentos\)/);
    expect(note).toMatch(/não aconteceram em nenhum dia dele/);
    expect(note).toMatch(/No período anterior: R\$\s?5\.226,20/);
  });
});

describe("carregamento: o que é 'de outra fatura'", () => {
  const card = { credit_card_id: "cc", payment_method: "credit_card" };
  it("parcela 2+ de compra antiga e compra depois do fechamento: carried", () => {
    expect(isCarriedCardEntry({ ...card, occurred_at: "2026-09-30", purchase_date: "2026-09-30", competence_date: "2026-11-01" })).toBe(true);
    expect(isCarriedCardEntry({ ...card, occurred_at: "2026-10-27", purchase_date: "2026-10-27", competence_date: "2026-11-01" })).toBe(true);
  });
  it("compra do mesmo mês da fatura, conta e Pix: não é carried (seguem a data real)", () => {
    expect(isCarriedCardEntry({ ...card, occurred_at: "2026-11-02", purchase_date: "2026-11-02", competence_date: "2026-11-01" })).toBe(false);
    expect(isCarriedCardEntry({ payment_method: "account", occurred_at: "2026-11-02" })).toBe(false);
    expect(chartDateOf({ ...card, occurred_at: "2026-11-02", purchase_date: "2026-11-02", competence_date: "2026-11-01" }, 24)).toBe("2026-11-02");
  });
});
