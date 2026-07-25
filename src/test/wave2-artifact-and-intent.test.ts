import { describe, it, expect } from "vitest";
import { validateChartArtifactV2 } from "../../supabase/functions/_shared/artifacts/schema.ts";
import { routeIntent } from "../../supabase/functions/_shared/agent/core/IntentRouter.ts";

describe("chart.artifact.v2 schema", () => {
  it("valida payload v2 completo", () => {
    const r = validateChartArtifactV2({
      kind: "chart",
      chart: {
        type: "bar",
        x_labels: ["A", "B"],
        series: [{ name: "Antes", data: [1, 2] }, { name: "Agora", data: [3, 4] }],
      },
      provenance: { formula_version: "compare.v1" },
      a11y_summary: "ok",
    });
    expect(r.ok).toBe(true);
    expect(r.version).toBe("v2");
  });

  it("detecta v1 sem barrar", () => {
    const r = validateChartArtifactV2({
      data: { series: [{ name: "x", value: 10 }] },
    });
    expect(r.version).toBe("v1");
  });

  it("acusa erros de v2 malformado", () => {
    const r = validateChartArtifactV2({
      kind: "chart",
      chart: { type: "pizza", x_labels: [], series: [{ name: "x", data: [Number.NaN] }] },
    });
    expect(r.ok).toBe(false);
    expect(r.version).toBe("v2");
    expect(r.errors.some((e) => e.includes("invalid_chart_type"))).toBe(true);
    expect(r.errors.some((e) => e.includes("non_finite"))).toBe(true);
  });
});

describe("IntentRouter visualization hint", () => {
  it("marca hint quando o texto pede gráfico", () => {
    expect(routeIntent("me mostra um gráfico dos gastos").visualization_hint).toBe(true);
    expect(routeIntent("manda uma imagem disso").visualization_hint).toBe(true);
  });
  it("não marca hint em texto neutro", () => {
    expect(routeIntent("gastei 50 no ifood").visualization_hint).toBe(false);
  });
});
