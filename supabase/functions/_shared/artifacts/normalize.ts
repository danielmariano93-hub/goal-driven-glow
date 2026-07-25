// Normalizador de artefatos: unifica payloads v1 (data.series[{name,value}])
// e v2 (chart.series[{name,data[]}] + chart.x_labels) em uma estrutura única
// consumida pelo renderer PNG e por qualquer futuro consumidor server-side.
// Mantém a mesma semântica de v1 (bar/line) e não calcula nada — só reformata.
// deno-lint-ignore-file no-explicit-any

export type RenderableSeries = {
  kind: string;
  title: string;
  labels: string[];
  values: number[];
  summary_text?: string;
  fallback_text?: string;
  formula_version?: string;
  confidence?: string;
  row_count?: number;
  isLine: boolean;
};

function pickV2Series(chart: any): { labels: string[]; values: number[] } {
  const labels: string[] = Array.isArray(chart?.x_labels) ? chart.x_labels.map(String) : [];
  const primary = Array.isArray(chart?.series) && chart.series.length > 0 ? chart.series[0] : null;
  const rawValues: any[] = Array.isArray(primary?.data) ? primary.data : [];
  const values = rawValues.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  return { labels: labels.slice(0, values.length), values };
}

function pickV1Series(data: any): { labels: string[]; values: number[] } {
  const series: Array<{ name: string; value: number }> =
    Array.isArray(data?.series) ? data.series : [];
  const labels = series.map((s) => String(s?.name ?? ""));
  const values = series.map((s) => Number(s?.value)).map((v) => Number.isFinite(v) ? v : 0);
  return { labels, values };
}

export function toRenderableSeries(payload: any): RenderableSeries {
  const isV2 = payload && payload.chart && Array.isArray(payload.chart.series);
  const chart = isV2 ? payload.chart : null;
  const kind = String(payload?.kind ?? chart?.type ?? "chart");
  const title = String(payload?.title ?? chart?.title ?? payload?.headline ?? "Meu Nino");

  const { labels, values } = isV2 ? pickV2Series(chart) : pickV1Series(payload?.data);

  const chartType = String(chart?.type ?? "");
  const isLine = /line|area|forecast_band|timeseries|average_daily_trend/i.test(chartType + " " + kind)
    || values.length > 12;

  return {
    kind,
    title,
    labels,
    values,
    summary_text: payload?.summary_text ?? payload?.narrative,
    fallback_text: payload?.fallback_text ?? payload?.a11y_summary,
    formula_version: payload?.provenance?.formula_version,
    confidence: payload?.provenance?.confidence,
    row_count: payload?.provenance?.row_count,
    isLine,
  };
}
