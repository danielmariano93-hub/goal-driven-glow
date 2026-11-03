import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildReportDashboard, type DashEntry } from "@/lib/engine/reportDashboard";
import { EvolutionChart } from "@/components/reports/DashboardCharts";
import { purchaseDayOf, toLedger } from "../../supabase/functions/_shared/insights/executive/load";

// `report_evolution.v3`: o gráfico diário responde "quanto gastei neste dia". Cartão = dia da compra; parcela 2+ de compra
// antiga não foi gasto de dia nenhum deste período. O total do período segue a fatura, e a diferença é declarada.
const e = (id: string, date: string, amount: number, extra: Partial<DashEntry> = {}): DashEntry => ({
  id, date, kind: "expense", amount, category_id: "c", category: "Serviços", merchant_key: id, merchant: id, ...extra,
} as DashEntry);

// Caso real (3/11): fatura de novembro = parcelas de JIM.COM (compras de 30/07 e 30/09) + compra de 27/10 + o que foi comprado em nov.
const entries: DashEntry[] = [
  e("conta", "2026-11-01", 443.95),
  e("compra-nov", "2026-11-01", 50, { chart_date: "2026-11-02" }),
  e("jim-2", "2026-11-01", 545.13, { chart_date: "2026-09-30", chart_carried: true }),
  e("jim-4", "2026-11-01", 508.79, { chart_date: "2026-07-30", chart_carried: true }),
  e("claude", "2026-11-01", 129.9, { chart_date: "2026-10-27" }), // compra à vista de 27/10, fatura de novembro
  e("out-conta", "2026-10-02", 100),
  e("out-fatura", "2026-10-01", 5226.2, { chart_date: "2026-04-30", chart_carried: true }),
];
const dash = (list = entries, extra: Record<string, string> = {}) =>
  buildReportDashboard(list, { today: "2026-11-03", start: "2026-11-01", end: "2026-11-03", compare: "previous", ...extra });

describe("gráfico 'quanto saiu': cada barra é o que foi gasto naquele dia", () => {
  const d = dash();
  it("o total do período continua incluindo tudo (fatura)", () => {
    expect(d.totals.expense).toBeCloseTo(443.95 + 50 + 545.13 + 508.79 + 129.9, 2);
  });
  it("nenhum pico em 03/11: parcela de compra antiga e compra de 27/10 não são gasto desses dias", () => {
    expect(d.series.map((p) => p.expense)).toEqual([443.95, 50, 0]);
  });
  it("a linha do período anterior também não ganha pico no último dia", () => {
    expect(d.series.map((p) => p.previousExpense)).toEqual([0, 100, 0]);
  });
  it("a diferença para o total é declarada, com valor e quantidade", () => {
    expect(d.barsGap!.notInBars).toEqual({ amount: 1183.82, count: 3 });
    expect(d.barsGap!.notInTotal).toEqual({ amount: 0, count: 0 });
    expect(d.barsGap!.previous).toEqual({ notInBars: 5226.2, notInTotal: 0 });
  });
  it("barras + (o que está no total e não nas barras) − (o que está nas barras e não no total) = total", () => {
    const bars = d.series.reduce((a, p) => a + p.expense, 0);
    expect(bars + d.barsGap!.notInBars.amount - d.barsGap!.notInTotal.amount).toBeCloseTo(d.totals.expense, 2);
  });
  it("a compra à vista de 27/10 aparece em OUTUBRO, no dia em que foi feita (e fica fora do total de outubro)", () => {
    const oct = buildReportDashboard(entries, { today: "2026-11-03", start: "2026-10-01", end: "2026-10-31", compare: "none" });
    expect(oct.series.find((p) => p.from === "2026-10-27")!.expense).toBe(129.9);
    expect(oct.barsGap!.notInTotal).toEqual({ amount: 129.9, count: 1 });
    expect(oct.totals.expense).toBeCloseTo(100 + 5226.2, 2);
  });
  it("granularidade mensal: nada muda e não há nota", () => {
    const m = buildReportDashboard(entries, { today: "2026-11-30", start: "2025-11-01", end: "2026-11-30", compare: "none" });
    expect(m.barsGap).toBeNull();
  });
  it("sem diferença entre barras e total, não há nota", () => {
    expect(dash([e("a", "2026-11-01", 10), e("b", "2026-11-02", 20, { chart_date: "2026-11-02" })]).barsGap).toBeNull();
  });
  it("a tela explica o que as barras mostram e o que ficou de fora", () => {
    render(<EvolutionChart d={d} />);
    const note = screen.getByTestId("evolution-gap").textContent ?? "";
    expect(note).toMatch(/As barras mostram o dia em que você gastou \(data da compra\)\. O total do período segue a fatura\./);
    expect(note).toMatch(/Fora das barras: R\$\s?1\.183,82 em parcelas e compras de faturas anteriores \(3 lançamentos\)/);
    expect(note).not.toMatch(/Nas barras e ainda fora do total/);
  });
  it("a tela também declara compras do período que só entram na fatura seguinte", () => {
    const oct = buildReportDashboard(entries, { today: "2026-11-03", start: "2026-10-01", end: "2026-10-31", compare: "none" });
    render(<EvolutionChart d={oct} />);
    expect(screen.getByTestId("evolution-gap").textContent).toMatch(/Nas barras e ainda fora do total: R\$\s?129,90 em compras deste período \(1 lançamento\) que só entram na fatura seguinte/);
  });
});

describe("carga do livro: dia do gráfico e parcela antiga", () => {
  const card = { credit_card_id: "cc", payment_method: "credit_card", type: "expense", status: "confirmed", movement_kind: "transaction", category_id: "c", description: "X", transfer_group_id: null, settles_card_id: null };
  it("cartão = dia da compra; conta/Pix = null (usa a data do lançamento)", () => {
    expect(purchaseDayOf({ ...card, occurred_at: "2026-10-27", purchase_date: "2026-10-27", competence_date: "2026-11-01" })).toBe("2026-10-27");
    expect(purchaseDayOf({ payment_method: "account", occurred_at: "2026-11-02" })).toBeNull();
  });
  it("parcela 2+ de compra antiga é 'carried'; a compra à vista depois do fechamento e a 1ª parcela não são", () => {
    const rows = [
      { ...card, id: "p2", amount: 545.13, occurred_at: "2026-09-30", purchase_date: "2026-09-30", competence_date: "2026-11-01", installment_number: 2, installments_total: 6, purchase_group_id: "g" },
      { ...card, id: "p1", amount: 545.13, occurred_at: "2026-09-30", purchase_date: "2026-09-30", competence_date: "2026-10-01", installment_number: 1, installments_total: 6, purchase_group_id: "g" },
      { ...card, id: "vista", amount: 129.9, occurred_at: "2026-10-27", purchase_date: "2026-10-27", competence_date: "2026-11-01", installment_number: 1, installments_total: 1 },
    ];
    const out = toLedger(rows, new Map([["c", "Serviços"]]), [], { from: "2026-09-01", to: "2026-12-31" });
    const by = Object.fromEntries(out.map((x) => [x.id, x]));
    expect(by.p2.chart_carried).toBe(true);
    expect(by.p1.chart_carried).toBe(false);
    expect(by.vista.chart_carried).toBe(false);
    expect(by.vista.chart_date).toBe("2026-10-27");
  });
});
