// Regressão (30/09): o gráfico diário de "Transporte no Uber" foi gravado sem
// `metrics`/`narrative`; o renderizador fazia `metrics.length` e a tela inteira
// do assessor caía no "Algo saiu do previsto" sempre que a conversa abria.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartArtifactRenderer } from "@/components/assessor/artifacts/ChartArtifactRenderer";
import { normalizeChartArtifact } from "@/components/assessor/artifacts/normalizeChartArtifact";
import { buildScopedSeries } from "../../supabase/functions/_shared/agent/core/handlers/ScopedSeriesHandler";
import { completeChartContract, seriesChartFromEvidence } from "../../supabase/functions/_shared/intelligence/chartTemplates";

// Payload exatamente como foi gravado em produção (artefato 30394803…).
const BROKEN_PRODUCTION_PAYLOAD = {
  kind: "chart",
  title: "Gastos dia a dia · Transporte no Uber",
  headline: "Gastos dia a dia · Transporte no Uber",
  summary_text: "📊 Gastos dia a dia · Transporte no Uber\n• Período: 01/09 a 30/09.\n• Total gasto: R$ 697,01 em 34 lançamentos.",
  fallback_text: "…",
  a11y_summary: "Gastos dia a dia em Transporte no Uber.",
  chart: {
    type: "bar",
    title: "Gasto do dia",
    x_labels: ["01/09", "02/09", "03/09"],
    series: [{ name: "Gasto do dia", data: [22.1, 0, 18.9], color: "#6D3BFF", render_as: "bar" }],
    units: "BRL",
    y_format: "currency",
  },
  provenance: {
    formula_version: "scoped_spending_series.v1", row_count: 34, confidence: "high",
    source: "nino_scoped_series.v1", period: { from: "2026-09-01", to: "2026-09-30" },
  },
};

// recharts ResponsiveContainer precisa de ResizeObserver no jsdom.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;

describe("assessor: gráfico nunca derruba a tela", () => {
  it("renderiza o payload que quebrou a produção", () => {
    render(<ChartArtifactRenderer artifact={BROKEN_PRODUCTION_PAYLOAD} />);
    expect(screen.getByText("Gastos dia a dia · Transporte no Uber")).toBeTruthy();
  });

  it("payload inválido não renderiza nada (e não lança)", () => {
    for (const bad of [null, undefined, "x", {}, { chart: {} }, { chart: { x_labels: ["a"], series: "x" } }]) {
      const { container } = render(<ChartArtifactRenderer artifact={bad} />);
      expect(container.textContent).toBe("");
    }
  });

  it("normaliza campos ausentes para o contrato", () => {
    const n = normalizeChartArtifact(BROKEN_PRODUCTION_PAYLOAD)!;
    expect(n.metrics).toEqual([]);
    expect(n.narrative).toBe("");
    expect(n.provenance).toMatchObject({ period: { from: "2026-09-01", to: "2026-09-30" }, confidence: "high", row_count: 34 });
    expect(n.chart.series[0].data).toEqual([22.1, 0, 18.9]);
  });
});

describe("backend: todo gráfico de série sai no contrato do app", () => {
  it.each(["day", "week", "quarter"] as const)("template %s tem headline, narrative, metrics e provenance completos", (grain) => {
    const result = buildScopedSeries(
      [{ date: "2026-09-05", amount: 65.94 }, { date: "2026-09-19", amount: 81.96 }],
      { grain, from: grain === "quarter" ? "2026-01-01" : "2026-09-01", to: "2026-09-30", category_label: "Transporte", merchant: "Uber" },
    );
    const payload = seriesChartFromEvidence(result, grain)!.payload as Record<string, unknown>;
    expect(typeof payload.narrative).toBe("string");
    expect((payload.metrics as unknown[]).length).toBeGreaterThan(0);
    expect(payload.provenance).toMatchObject({ confidence: "high", period: { tz: "America/Sao_Paulo" } });
    expect(normalizeChartArtifact(payload)).not.toBeNull();
    render(<ChartArtifactRenderer artifact={payload} />);
  });

  it("completeChartContract preenche o que faltar antes de gravar", () => {
    const completed = completeChartContract(BROKEN_PRODUCTION_PAYLOAD as Record<string, unknown>) as Record<string, unknown>;
    expect(completed.metrics).toEqual([]);
    expect(completed.narrative).toBe("Período: 01/09 a 30/09.");
    expect(completed.provenance).toMatchObject({ period: { tz: "America/Sao_Paulo" } });
  });
});
