import { describe, expect, it } from "vitest";
import {
  buildMonthlyDailyChart,
  grossDailySpend,
  monthlyChartCaption,
  REPORT_DAILY_CHART_VERSION,
  trailingAverage,
} from "@/lib/reports/intelligent/whatsappChart";
import type { IntelligentReport } from "@/lib/reports/intelligent/types";
import type { TransactionRow } from "@/lib/engine/facts";
import { toRenderableSeries } from "../../supabase/functions/_shared/artifacts/normalize";
import {
  barAmountLabel,
  chartDayLabel,
  renderArtifactPng,
} from "../../supabase/functions/_shared/artifacts/png";

function reportFixture(): IntelligentReport {
  const period = { start: "2026-09-01", end: "2026-09-03", label: "setembro de 2026" };
  const previousPeriod = { start: "2026-08-01", end: "2026-08-03", label: "agosto de 2026" };
  return {
    reportType: "monthly_partial",
    period,
    previousPeriod,
    metrics: [],
    highlights: [
      {
        detectorKey: "peak_day",
        type: "info",
        title: "Terça concentrou os gastos",
        body: "O maior movimento do período aconteceu na terça.",
        priority: 90,
        confidence: "high",
        evidence: {},
        dedupKey: "peak_day:2026-09",
        selectionReason: "highest_daily_expense",
      },
      {
        detectorKey: "category_change",
        type: "opportunity",
        title: "Mercado merece atenção",
        body: "A categoria avançou no período.",
        priority: 80,
        confidence: "medium",
        evidence: {},
        dedupKey: "category_change:2026-09",
        selectionReason: "largest_category_change",
      },
    ],
    healthScore: 8,
    healthBreakdown: [],
    dataQualityStatus: "ok",
    dataQualityFlags: [],
    catalogVersion: "reports_catalog.v1",
    templateVersion: "report_template.v5",
    payload: {
      version: "reports_catalog.v1",
      reportType: "monthly_partial",
      period,
      previousPeriod,
      totals: {
        income: 1000,
        expense: 360,
        net: 640,
        savingsRate: 0.64,
        previousExpense: 300,
        previousIncome: 1000,
        expenseDeltaPct: 20,
        dailyAvgExpense: 120,
        daysWithExpense: 3,
        transactionCount: 3,
        biggestExpense: null,
        essentialTotal: 250,
        flexibleTotal: 110,
        cardOutstanding: 0,
        cashTotal: 1000,
      },
      categories: [],
      series: [
        { label: "01/09", date: "2026-09-01", expense: 100, income: 0, cumulativeExpense: 100 },
        { label: "02/09", date: "2026-09-02", expense: 60, income: 0, cumulativeExpense: 160 },
        { label: "03/09", date: "2026-09-03", expense: 200, income: 0, cumulativeExpense: 360 },
      ],
      goals: [],
      partial: {
        daysElapsed: 3,
        daysInMonth: 30,
        projectedExpense: 3600,
        projectedIncome: 10000,
        comparableWindow: true,
      },
    },
  };
}

function transactionsFixture(): TransactionRow[] {
  const base = {
    account_id: "account-1",
    category_id: null,
    status: "confirmed" as const,
    description: "Teste",
    transfer_group_id: null,
    payment_method: "account",
    credit_card_id: null,
    competence_date: null,
    settles_card_id: null,
  };
  return [
    { ...base, id: "expense-1", type: "expense", amount: 100, occurred_at: "2026-09-01", movement_kind: "transaction" },
    { ...base, id: "expense-2", type: "expense", amount: 60, occurred_at: "2026-09-02", movement_kind: "transaction" },
    { ...base, id: "expense-3", type: "expense", amount: 200, occurred_at: "2026-09-03", movement_kind: "transaction" },
    // Entradas não podem reduzir uma barra de gasto bruto.
    { ...base, id: "refund-1", type: "income", amount: 400, occurred_at: "2026-09-02", movement_kind: "refund" },
    { ...base, id: "income-1", type: "income", amount: 900, occurred_at: "2026-09-03", movement_kind: "transaction" },
    // Pagamento de fatura não é novo consumo e seria dupla contagem.
    { ...base, id: "card-payment-1", type: "expense", amount: 800, occurred_at: "2026-09-03", movement_kind: "card_payment" },
  ];
}

describe("monthly WhatsApp spending chart", () => {
  it("calculates a trailing seven-day average without inventing future days", () => {
    expect(trailingAverage([10, 20, 30, 40, 50, 60, 70, 80], 7))
      .toEqual([10, 15, 20, 25, 30, 35, 40, 50]);
  });

  it("builds bars plus a smooth-line series from the canonical report payload", () => {
    const report = reportFixture();
    const artifact = buildMonthlyDailyChart(report, "Resumo determinístico", transactionsFixture());
    const normalized = toRenderableSeries(artifact);

    expect(artifact.provenance.formula_version).toBe(REPORT_DAILY_CHART_VERSION);
    expect(normalized.labels).toEqual(["01/09", "02/09", "03/09"]);
    expect(normalized.series).toHaveLength(2);
    expect(normalized.series[0]).toMatchObject({ name: "Gasto diário", renderAs: "bar", values: [100, 60, 200] });
    expect(normalized.series[1]).toMatchObject({ name: "Média de 7 dias", renderAs: "line", values: [100, 80, 120] });
  });

  it("uses only eligible outgoing expenses and never subtracts incoming money", () => {
    expect(grossDailySpend(reportFixture(), transactionsFixture())).toEqual([100, 60, 200]);
  });

  it("keeps the caption concise and grounded in report highlights", () => {
    const caption = monthlyChartCaption(reportFixture(), "https://meunino.com.br/r/teste", transactionsFixture());

    const readableCaption = caption.replace(/\u00a0/g, " ");
    expect(readableCaption).toContain("R$ 360,00");
    expect(readableCaption).toContain("R$ 200,00 em 03/09");
    expect(caption).toContain("Terça concentrou os gastos");
    expect(caption).toContain("Mercado merece atenção");
    expect(caption.length).toBeLessThanOrEqual(950);
  });

  it("renders a valid PNG for WhatsApp", async () => {
    const png = await renderArtifactPng(
      buildMonthlyDailyChart(reportFixture(), "Resumo determinístico", transactionsFixture()),
    );

    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.length).toBeGreaterThan(1000);
  });

  it("formats discreet bar totals and day-of-month labels", () => {
    expect(barAmountLabel(928.84)).toBe("928,84");
    expect(barAmountLabel(-527.08)).toBe("-527,08");
    expect(barAmountLabel(1234.56)).toBe("1,2k");
    expect(barAmountLabel(342.45, false)).toBe("342");
    expect(chartDayLabel("09/09")).toBe("09");
  });
});
