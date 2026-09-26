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

  it("recognizes category + merchant as a first-class monthly series shape", () => {
    expect(isMonthlySeriesShape(query({
      filters: [
        { field: "category", op: "eq", value: "Alimentação" },
        { field: "merchant", op: "eq", value: "Thales" },
      ],
    }))).toBe(true);
    expect(isMonthlySeriesShape(query({ grain: "day" }))).toBe(false);
  });

  it("formats deterministic monthly facts without inventing a zero for missing data", () => {
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
    expect(text).toContain("ago/26");
    expect(text).toContain("R$ 123,45");
    expect(text).toContain("set/26 (parcial): sem lançamentos encontrados");
    expect(text).toContain("Alimentação");
    expect(text).toContain("Thales");
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
