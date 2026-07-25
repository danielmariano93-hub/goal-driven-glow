// Zod-lite validation for chart.artifact.v2 payloads. Runs in Edge Functions
// (Deno) without pulling zod. Returns a normalized error list so callers can
// choose to log-and-continue (soft) or block persistence (strict). Onda 2.3.
// deno-lint-ignore-file no-explicit-any

export type ChartArtifactValidation = {
  ok: boolean;
  errors: string[];
  version: "v1" | "v2" | "unknown";
};

const ALLOWED_CHART_TYPES = new Set([
  "line", "bar", "stacked_bar", "donut", "area", "progress", "forecast_band",
]);
const ALLOWED_KINDS = new Set(["chart", "report", "goal_projection", "forecast"]);

export function validateChartArtifactV2(payload: any): ChartArtifactValidation {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["payload_not_object"], version: "unknown" };
  }

  // Detecção de versão: v2 tem chart.series[{data[]}] + chart.x_labels
  const isV2 = payload.chart && Array.isArray(payload.chart.series)
    && (payload.chart.series.length === 0 || Array.isArray(payload.chart.series[0]?.data));
  const isV1 = !isV2 && payload.data && Array.isArray(payload.data.series);
  const version: "v1" | "v2" | "unknown" = isV2 ? "v2" : isV1 ? "v1" : "unknown";

  if (version === "unknown") {
    errors.push("no_recognizable_series_shape");
    return { ok: false, errors, version };
  }

  if (version === "v2") {
    if (!ALLOWED_KINDS.has(String(payload.kind))) errors.push(`invalid_kind:${payload.kind}`);
    const c = payload.chart;
    if (!ALLOWED_CHART_TYPES.has(String(c.type))) errors.push(`invalid_chart_type:${c.type}`);
    if (!Array.isArray(c.x_labels)) errors.push("chart.x_labels_missing");
    if (!Array.isArray(c.series) || c.series.length === 0) errors.push("chart.series_empty");
    else {
      for (const [i, s] of c.series.entries()) {
        if (typeof s?.name !== "string") errors.push(`series[${i}].name_not_string`);
        if (!Array.isArray(s?.data)) errors.push(`series[${i}].data_not_array`);
        else if (s.data.some((v: any) => !Number.isFinite(Number(v)))) {
          errors.push(`series[${i}].data_has_non_finite`);
        }
      }
    }
    if (!payload.provenance || typeof payload.provenance.formula_version !== "string") {
      errors.push("provenance.formula_version_missing");
    }
    if (typeof payload.a11y_summary !== "string" && typeof payload.fallback_text !== "string") {
      errors.push("a11y_or_fallback_text_missing");
    }
  }

  return { ok: errors.length === 0, errors, version };
}
