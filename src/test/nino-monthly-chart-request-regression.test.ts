import { describe, expect, it } from "vitest";
import { inferChartRequest } from "../../supabase/functions/_shared/intelligence/chartIntent";
import { resolvePeriodPt, resolveTimeAspectPt } from "../../supabase/functions/_shared/analytics/periodResolver";
import { deterministicConversationFastPath } from "../../supabase/functions/_shared/agent/core/DeterministicConversationFastPath";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";
import { normalizeToV3, isMonthlySeriesShape } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import { applyTurnAspect } from "../../supabase/functions/_shared/agent/core/SemanticAspectOverlay";
import { buildMonthlySeriesChartArtifact, monthlySeriesChartCaption } from "../../supabase/functions/_shared/intelligence/monthlySeriesChart";

const NOW = new Date("2026-09-27T17:47:00.000Z");
const TEXT = "Faça um gráfico dos últimos 4 meses de quanto gastei em lazer";

describe("regressão — gráfico dos últimos N meses", () => {
  it("classifica o pedido explícito como série mensal, não timeseries diária", () => {
    expect(inferChartRequest(TEXT)).toEqual({ mode: "monthly_series" });
    expect(inferChartRequest("Faça um gráfico dia a dia dos últimos 4 meses de quanto gastei em lazer"))
      .toEqual({ mode: "daily_series" });
  });

  it("preserva janela corrida para pergunta comum, mas usa 4 meses-calendário no gráfico", () => {
    const plain = resolvePeriodPt(TEXT, NOW);
    expect(plain).toMatchObject({ from: "2026-05-27", to: "2026-09-27" });

    const aspect = resolveTimeAspectPt(TEXT, NOW);
    expect(aspect).toMatchObject({
      aspect: "trend",
      from: "2026-06-01",
      to: "2026-09-27",
      n: 4,
      grain: "month",
      reduce: "none",
      exclude_partial: false,
    });
  });

  it("leva a frase exata até o shape mensal executável sem chamar LLM", () => {
    const turn = deterministicConversationFastPath({ text: TEXT, memory: null });
    expect(turn).not.toBeNull();
    expect(turn?.financial_read?.queries[0]).toMatchObject({
      metric: "expense_amount",
      operation: "sum",
      filters: [{ field: "category", op: "eq", value: "Lazer" }],
    });

    const preliminary = resolvePeriodPt(TEXT, NOW)!;
    const compiled = compileFinancialReadFromTurn({
      turn: turn!,
      period: { from: preliminary.from, to: preliminary.to, label: preliminary.label },
      comparison_period: null,
    });
    expect(compiled?.ir).toBeTruthy();

    const v3 = normalizeToV3(compiled!.ir, { today: "2026-09-27" });
    const overlaid = applyTurnAspect(v3, TEXT, NOW);
    const query = overlaid.ir.queries[0];

    expect(query).toMatchObject({
      metric: "expense_amount",
      time: {
        aspect: "trend",
        from: "2026-06-01",
        to: "2026-09-27",
        n: 4,
      },
      grain: "month",
      reduce: "none",
      filters: [{ field: "category", op: "eq", value: "Lazer" }],
    });
    expect(isMonthlySeriesShape(query)).toBe(true);
  });

  it("renderiza o padrão oficial em barras mensais e legenda coerente", () => {
    const result = {
      version: "nino_monthly_series.v1" as const,
      formula_version: "monthly_spending_series.v1" as const,
      months: [
        { month: "2026-06", total: 2718.38, has_data: true, transaction_count: 39 },
        { month: "2026-07", total: 2226.69, has_data: true, transaction_count: 29 },
        { month: "2026-08", total: 1414.21, has_data: true, transaction_count: 30 },
        { month: "2026-09", total: 1437.57, has_data: true, transaction_count: 20 },
      ],
      total: 7796.85,
      transaction_count: 118,
      window: { from: "2026-06-01", to: "2026-09-27", n: 4 },
      scope: { category: "Lazer", merchant: null },
      partial_first_month: false,
      partial_last_month: true,
    };

    const artifact = buildMonthlySeriesChartArtifact(result);
    expect(artifact.chart.type).toBe("bar");
    expect(artifact.chart.x_labels).toEqual(["jun/26", "jul/26", "ago/26", "set/26"]);
    expect(artifact.chart.series[0]).toMatchObject({
      name: "Gasto mensal",
      render_as: "bar",
      data: [2718.38, 2226.69, 1414.21, 1437.57],
    });
    expect(artifact.chart.series[1].render_as).toBe("line");

    const caption = monthlySeriesChartCaption(result).replace(/\u00a0/g, " ");
    expect(caption).toContain("Gastos mês a mês · Lazer");
    expect(caption).toContain("01/06/2026 a 27/09/2026");
    expect(caption).toContain("Setembro está parcial: considerado até 27/09");
    expect(caption).not.toContain("27/05/2026");
  });
});
