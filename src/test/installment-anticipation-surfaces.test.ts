// `installment_anticipation.v1` — as superfícies (insight, painel, destaque, gráfico)
// tratam antecipação como liquidação de dívida, não como gasto do mês.
import { describe, expect, it } from "vitest";
import {
  computeExecutiveInsights,
  type LedgerEntry,
} from "../../supabase/functions/_shared/insights/executive/engine";
import { chartDateOf, collectAnticipations } from "../../supabase/functions/_shared/insights/executive/load";
import { summarizeAnticipation } from "../../supabase/functions/_shared/reportsDashboard/runtime";
import { buildReportDashboard, type DashEntry } from "@/lib/engine/reportDashboard";
import { detectHighlights } from "@/lib/reports/intelligent/highlights";

describe("insight executivo", () => {
  const entries: LedgerEntry[] = ["2026-08", "2026-09", "2026-10"].flatMap((m) => [
    { id: `r-${m}`, date: `${m}-05`, kind: "income" as const, amount: 9000, category_id: "sal", category: "Salário", merchant_key: null, merchant: null },
    { id: `m-${m}`, date: `${m}-10`, kind: "expense" as const, amount: 3000, category_id: "mor", category: "Moradia", merchant_key: "ls", merchant: "LS" },
  ]);
  const anticipations = [
    { billed_month: "2026-10", economic_month: "2026-11", amount: 508.79, group: "g1" },
    { billed_month: "2026-10", economic_month: "2026-12", amount: 508.79, group: "g1" },
    { billed_month: "2026-10", economic_month: "2026-11", amount: 545.13, group: "g2" },
  ];

  it("aparece como positivo e explica que não é gasto novo", () => {
    const b = computeExecutiveInsights({ as_of: "2026-10-27", entries, anticipations });
    const i = b.insights.find((x) => x.kind === "installment_anticipation");
    expect(i).toBeTruthy();
    expect(i!.severity).toBe("positive");
    expect(i!.direction).toBe("better");
    expect(i!.why).toContain("não gasto novo");
    expect(i!.evidence.join(" ")).toContain("3 parcelas antecipadas");
  });

  it("some quando não há antecipação relevante", () => {
    const b = computeExecutiveInsights({ as_of: "2026-10-27", entries, anticipations: [] });
    expect(b.insights.some((x) => x.kind === "installment_anticipation")).toBe(false);
  });
});

describe("carga do livro", () => {
  it("coleta antecipações com mês cobrado e mês econômico", () => {
    const out = collectAnticipations([
      { id: "a", status: "confirmed", type: "expense", amount: 100, installment_anticipated: true, competence_date: "2026-10-01", economic_competence_date: "2026-12-01", purchase_group_id: "g" },
      { id: "b", status: "confirmed", type: "expense", amount: 50, installment_anticipated: false, competence_date: "2026-10-01" },
    ]);
    expect(out).toEqual([{ billed_month: "2026-10", economic_month: "2026-12", amount: 100, group: "g" }]);
  });

  it("gráfico diário: compra do mês no dia da compra; parcela antiga no fechamento; nunca dia 1", () => {
    const base = { credit_card_id: "c", payment_method: "credit_card", competence_date: "2026-10-01" };
    expect(chartDateOf({ ...base, purchase_date: "2026-10-18", occurred_at: "2026-10-18" }, 24)).toBe("2026-10-18");
    expect(chartDateOf({ ...base, purchase_date: "2026-07-26", occurred_at: "2026-07-26" }, 24)).toBe("2026-10-24");
    expect(chartDateOf({ ...base, purchase_date: "2026-09-30", occurred_at: "2026-09-30" }, 24)).toBe("2026-10-24");
    expect(chartDateOf({ payment_method: "account", occurred_at: "2026-10-03" }, null)).toBeNull();
  });
});

describe("painel de relatórios", () => {
  it("resume antecipações cobradas no período", () => {
    const rows = [
      { billed_month: "2026-10", economic_month: "2026-11", amount: 500, group: "g1" },
      { billed_month: "2026-10", economic_month: "2026-12", amount: 500, group: "g1" },
      { billed_month: "2026-09", economic_month: "2026-11", amount: 999, group: "g9" },
    ];
    const s = summarizeAnticipation(rows, "2026-10-01", "2026-10-31");
    expect(s).toEqual({ amount: 1000, count: 2, purchases: 1, months: [{ month: "2026-11", amount: 500 }, { month: "2026-12", amount: 500 }] });
    expect(summarizeAnticipation(rows, "2026-08-01", "2026-08-31")).toBeNull();
  });

  it("série diária usa a data da compra, mas o total do período não muda", () => {
    const mk = (id: string, date: string, chart: string | null, amount: number): DashEntry => ({
      id, date, kind: "expense", amount, category_id: "c", category: "Serviços", merchant_key: id, merchant: id, chart_date: chart,
    } as DashEntry);
    const entries = [
      mk("a", "2026-10-01", "2026-10-18", 100),
      mk("b", "2026-10-01", "2026-10-24", 300),
      mk("c", "2026-10-05", null, 50),
    ];
    const d = buildReportDashboard(entries, { today: "2026-10-27", start: "2026-10-01", end: "2026-10-27", compare: "none" });
    const day = (from: string) => d.series.find((p) => p.from === from)?.expense ?? 0;
    expect(day("2026-10-01")).toBe(0);
    expect(day("2026-10-18")).toBe(100);
    expect(day("2026-10-24")).toBe(300);
    expect(d.totals.expense).toBe(450);
    expect(d.series.reduce((s, p) => s + p.expense, 0)).toBe(450);
  });
});

describe("destaque do relatório inteligente", () => {
  it("destaca a antecipação como vitória, fora dos gastos", () => {
    const payload = {
      reportType: "monthly", period: { start: "2026-10-01", end: "2026-10-31", label: "outubro" },
      totals: { net: 100, income: 1000, expense: 900, savingsRate: 0.1, previousExpense: 900, previousIncome: 1000, expenseDeltaPct: 0, flexibleTotal: 300, essentialTotal: 600, dailyAvgExpense: 30, daysWithExpense: 20, transactionCount: 30, biggestExpense: null, cardOutstanding: 0, cashTotal: 0 },
      categories: [], series: [], goals: [], anticipation: { amount: 1000, count: 2, purchases: 1 },
    } as never;
    const h = detectHighlights(payload).find((x) => x.detectorKey === "installment_anticipation");
    expect(h?.type).toBe("win");
    expect(h?.body).toContain("não gasto novo");
  });
});
