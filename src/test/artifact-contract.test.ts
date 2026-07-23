import { describe, it, expect } from "vitest";
import { buildCompareArtifact, buildForecastArtifact, buildGoalArtifact } from "../../supabase/functions/_shared/artifacts/builder";
import type { CompareResult } from "../../supabase/functions/_shared/analytics/compare";
import type { ForecastResult } from "../../supabase/functions/_shared/analytics/forecast";

const baseProv = {
  period: { from: "2026-06-01", to: "2026-07-15", tz: "America/Sao_Paulo" as const },
  as_of: new Date().toISOString(), row_count: 30,
  confidence: "medium" as const, formula_version: "compare.v1",
};

describe("ChartArtifact contract", () => {
  it("compare gera bar chart com séries antes/agora e provenance", () => {
    const cmp: CompareResult = {
      metric: "expense", total_a: 100, total_b: 200, delta_abs: 100, delta_pct: 1,
      by_group: [{ name: "Lazer", total_a: 50, total_b: 150, delta_abs: 100, delta_pct: 2 }],
      comparable: true, provenance: baseProv,
    };
    const a = buildCompareArtifact(cmp);
    expect(a.kind).toBe("chart");
    expect(a.chart.type).toBe("bar");
    expect(a.chart.series.map(s => s.name)).toEqual(["Antes", "Agora"]);
    expect(a.provenance.formula_version).toBe("compare.v1");
    expect(a.metrics.length).toBeGreaterThan(0);
  });

  it("forecast gera forecast_band com Observado e Projeção", () => {
    const f: ForecastResult = {
      month: "2026-07", point: 3000, low: 2500, high: 3500,
      model_used: "observed.v1",
      drivers: { mtd_expense: 1500, day_of_month: 15, days_in_month: 31, recurring_future: 500, seasonal_adjust: 0 },
      backtest_summary: null,
      provenance: { ...baseProv, formula_version: "forecast.observed.v1" },
    };
    const a = buildForecastArtifact(f);
    expect(a.kind).toBe("forecast");
    expect(a.chart.type).toBe("forecast_band");
    expect(a.chart.series.map(s => s.name).sort()).toEqual(["Observado", "Projeção"]);
    expect(a.chart.x_labels).toHaveLength(31);
  });

  it("goal gera progress com valor 0..1", () => {
    const a = buildGoalArtifact({
      goal_id: "g", name: "Reserva", current: 1500, target: 6000, remaining: 4500,
      required_pace_month: 500, observed_pace_month: 300,
      projected_date: "2027-03-01", days_ahead_or_late: 60,
      scenarios_default: [], provenance: { ...baseProv, formula_version: "goal.project.v1" },
    });
    expect(a.chart.type).toBe("progress");
    expect(a.chart.series[0].data[0]).toBeCloseTo(0.25, 2);
  });
});
