import { describe, expect, it } from "vitest";
import { resolveTimeAspectPt } from "../../supabase/functions/_shared/analytics/periodResolver";
import {
  isMonthlySeriesShape,
  type FinancialQueryV3,
} from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import {
  monthlySpendingSeriesText,
  type MonthlySpendingSeriesResult,
} from "../../supabase/functions/_shared/agent/core/handlers/MonthlySeriesHandler";
import { inferChartRequest } from "../../supabase/functions/_shared/intelligence/chartIntent";
import {
  buildMonthlySeriesChartArtifact,
  monthlySeriesChartCaption,
} from "../../supabase/functions/_shared/intelligence/monthlySeriesChart";
import { toRenderableSeries } from "../../supabase/functions/_shared/artifacts/normalize";
import { chartDayLabel } from "../../supabase/functions/_shared/artifacts/png";
// JS module is intentionally executable by Vercel outside the TS build.
// @ts-ignore
import { isVercelRelevantPath, shouldBuildForFiles } from "../../scripts/vercel-ignore-build.mjs";

const NOW = new Date("2026-09-26T15:00:00-03:00");

function query(overrides: Partial<FinancialQueryV3> = {}): FinancialQueryV3 {
  return {
    id: "q1",
    metric: "expense_amount",
    filters: [{ field: "category", op: "eq", value: "Alimentação" }],
    time: {
      aspect: "trend",
      from: "2026-04-01",
      to: "2026-09-26",
      n: 6,
      exclude_partial: false,
      label: "últimos 6 meses, mês a mês",
    },
    grain: "month",
    reduce: "none",
    group_by: [],
    limit: null,
    depends_on: [],
    legacy_operation: "sum",
    ...overrides,
  };
}

function thalesFixture(): MonthlySpendingSeriesResult {
  return {
    version: "nino_monthly_series.v1",
    formula_version: "monthly_spending_series.v1",
    months: [
      { month: "2026-04", total: 80, has_data: true, transaction_count: 1 },
      { month: "2026-05", total: 14, has_data: true, transaction_count: 1 },
      { month: "2026-06", total: 160, has_data: true, transaction_count: 1 },
      { month: "2026-07", total: 72, has_data: true, transaction_count: 2 },
      { month: "2026-08", total: 125, has_data: true, transaction_count: 3 },
      { month: "2026-09", total: 155, has_data: true, transaction_count: 3 },
    ],
    total: 606,
    transaction_count: 11,
    window: { from: "2026-04-01", to: "2026-09-26", n: 6 },
    scope: { category: "Lazer", merchant: "Thales" },
    partial_first_month: false,
    partial_last_month: true,
  };
}

describe("nino_monthly_series.v1", () => {
  it("resolves exactly 5 calendar buckets ending in the current partial month", () => {
    const aspect = resolveTimeAspectPt("quanto gastei mês a mês nos últimos 5 meses?", NOW);
    expect(aspect.aspect).toBe("trend");
    expect(aspect.grain).toBe("month");
    expect(aspect.n).toBe(5);
    expect(aspect.from).toBe("2026-05-01");
    expect(aspect.to).toBe("2026-09-26");
    expect(aspect.exclude_partial).toBe(false);
  });

  it("resolves 10 months dynamically instead of hard-coding six", () => {
    const aspect = resolveTimeAspectPt("separe por mês os últimos 10 meses", NOW);
    expect(aspect.n).toBe(10);
    expect(aspect.from).toBe("2025-12-01");
    expect(aspect.to).toBe("2026-09-26");
  });

  it("supports an exact closed-month window when explicitly requested", () => {
    const aspect = resolveTimeAspectPt("mês a mês nos últimos 5 meses fechados", NOW);
    expect(aspect.n).toBe(5);
    expect(aspect.from).toBe("2026-04-01");
    expect(aspect.to).toBe("2026-08-31");
    expect(aspect.exclude_partial).toBe(true);
  });

  it("recognizes category + merchant and merchant-only as first-class monthly series shapes", () => {
    expect(isMonthlySeriesShape(query({
      filters: [
        { field: "category", op: "eq", value: "Alimentação" },
        { field: "merchant", op: "eq", value: "Thales" },
      ],
    }))).toBe(true);
    expect(isMonthlySeriesShape(query({
      filters: [{ field: "merchant", op: "eq", value: "Thales" }],
    }))).toBe(true);
    expect(isMonthlySeriesShape(query({ grain: "day" }))).toBe(false);
  });

  it("formats deterministic monthly facts without inventing a value for missing data", () => {
    const result: MonthlySpendingSeriesResult = {
      version: "nino_monthly_series.v1",
      formula_version: "monthly_spending_series.v1",
      months: [
        { month: "2026-08", total: 123.45, has_data: true, transaction_count: 2 },
        { month: "2026-09", total: 0, has_data: false, transaction_count: 0 },
      ],
      total: 123.45,
      transaction_count: 2,
      window: { from: "2026-08-01", to: "2026-09-26", n: 2 },
      scope: { category: "Alimentação", merchant: "Thales" },
      partial_first_month: false,
      partial_last_month: true,
    };
    const text = monthlySpendingSeriesText(result);
    expect(text).toContain("* Agosto: R$ 123,45 — 2 lançamentos");
    expect(text).toContain("* Setembro: sem lançamentos encontrados");
    expect(text).toContain("Alimentação");
    expect(text).toContain("Thales");
    expect(text).toContain("mês parcial");
  });

  it("returns the conversational summary with total, monthly counts, average, peak and partial-month warning", () => {
    const text = monthlySpendingSeriesText(thalesFixture());
    expect(text).toContain("💸 Nos 6 meses analisados, de 01/04/2026 a 26/09/2026, você gastou R$ 606,00 em Lazer com Thales, em 11 lançamentos.");
    expect(text).toContain("* Abril: R$ 80,00 — 1 lançamento");
    expect(text).toContain("* Julho: R$ 72,00 — 2 lançamentos");
    expect(text).toContain("* Setembro: R$ 155,00 — 3 lançamentos");
    expect(text).toContain("Sua média foi de R$ 101,00 por mês.");
    expect(text).toContain("Junho teve o maior gasto, com R$ 160,00.");
    expect(text).toContain("Setembro já soma R$ 155,00, mas ainda é um mês parcial, considerado somente até o dia 26.");
  });

  it("builds the monthly WhatsApp artifact in the same visual family as the daily chart", () => {
    const artifact = buildMonthlySeriesChartArtifact(thalesFixture());
    const normalized = toRenderableSeries(artifact);
    expect(artifact.kind).toBe("chart");
    expect(normalized.labels).toEqual(["abr/26", "mai/26", "jun/26", "jul/26", "ago/26", "set/26"]);
    expect(normalized.series).toHaveLength(2);
    expect(normalized.series[0]).toMatchObject({
      name: "Gasto mensal",
      renderAs: "bar",
      values: [80, 14, 160, 72, 125, 155],
    });
    expect(normalized.series[1]).toMatchObject({
      name: "Média de 3 meses",
      renderAs: "line",
      values: [80, 47, 84.67, 82, 119, 117.33],
    });
  });

  it("uses a grounded WhatsApp image caption instead of a false render-failure message", () => {
    const caption = monthlySeriesChartCaption(thalesFixture()).replace(/\u00a0/g, " ");
    expect(caption).toContain("📊 Gastos mês a mês · Lazer com Thales");
    expect(caption).toContain("• Período: 01/04/2026 a 26/09/2026.");
    expect(caption).toContain("• Total gasto: R$ 606,00 em 11 lançamentos.");
    expect(caption).toContain("• Maior mês: R$ 160,00 em junho.");
    expect(caption).toContain("• Média mensal: R$ 101,00.");
    expect(caption).toContain("• Setembro está parcial: considerado até 26/09.");
    expect(caption).not.toContain("Não consegui exibir a imagem");
    expect(caption.length).toBeLessThanOrEqual(950);
  });

  it("routes explicit month-by-month chart intent before generic category charts", () => {
    expect(inferChartRequest("gere um gráfico de Alimentação mês a mês nos últimos 6 meses"))
      .toEqual({ mode: "monthly_series" });
  });

  it("renders monthly axis labels with month and year while preserving daily labels", () => {
    expect(chartDayLabel("jan/26")).toBe("01-26");
    expect(chartDayLabel("dez/25")).toBe("12-25");
    expect(chartDayLabel("23/09")).toBe("23");
  });
});

describe("Vercel impact gate", () => {
  it("skips Supabase-only, workflow and test changes", () => {
    expect(shouldBuildForFiles([
      "supabase/functions/agent-run/index.ts",
      ".github/workflows/nino-supabase-deploy.yml",
      "src/test/nino-monthly-series-v1.test.ts",
    ])).toBe(false);
  });

  it("still deploys real frontend and build-contract changes", () => {
    expect(isVercelRelevantPath("src/components/AppLayout.tsx")).toBe(true);
    expect(isVercelRelevantPath("public/favicon.svg")).toBe(true);
    expect(isVercelRelevantPath("package-lock.json")).toBe(true);
    expect(isVercelRelevantPath("bun.lock")).toBe(true);
    expect(isVercelRelevantPath(".npmrc")).toBe(true);
    expect(isVercelRelevantPath("scripts/sync-finance-core.mjs")).toBe(true);
    expect(shouldBuildForFiles(["supabase/functions/a.ts", "src/pages/Home.tsx"])).toBe(true);
  });
});