// Normalizador de artefatos: unifica payloads v1 (data.series[{name,value}])
// e v2 (chart.series[{name,data[]}] + chart.x_labels) em uma estrutura única
// consumida pelo renderer PNG e por qualquer futuro consumidor server-side.
// Não calcula métricas financeiras: apenas preserva e normaliza séries.
// deno-lint-ignore-file no-explicit-any

export type RenderableSeriesItem = {
  name: string;
  values: number[];
  color?: string;
  renderAs: "bar" | "line";
};

export type RenderableSeries = {
  kind: string;
  title: string;
  labels: string[];
  /** Compatibilidade com o renderer legado: primeira série normalizada. */
  values: number[];
  series: RenderableSeriesItem[];
  summary_text?: string;
  fallback_text?: string;
  formula_version?: string;
  confidence?: string;
  row_count?: number;
  isLine: boolean;
};

function finiteValues(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  // O validador rejeita não finitos. Aqui degradamos para zero para que um
  // artefato antigo nunca desalinhe labels e valores durante o fallback.
  return raw.map((value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  });
}

function pickV2Series(chart: any): { labels: string[]; series: RenderableSeriesItem[] } {
  const labels: string[] = Array.isArray(chart?.x_labels) ? chart.x_labels.map(String) : [];
  const chartType = String(chart?.type ?? "");
  const rawSeries = Array.isArray(chart?.series) ? chart.series : [];
  const series = rawSeries.map((item: any, index: number): RenderableSeriesItem => {
    const requested = String(item?.render_as ?? "");
    const renderAs: "bar" | "line" = requested === "bar" || requested === "line"
      ? requested
      : /line|area|forecast_band/i.test(chartType) ? "line" : "bar";
    return {
      name: String(item?.name ?? `Série ${index + 1}`),
      values: finiteValues(item?.data).slice(0, labels.length || undefined),
      color: typeof item?.color === "string" ? item.color : undefined,
      renderAs,
    };
  });
  const maxLength = series.reduce((max, item) => Math.max(max, item.values.length), 0);
  return { labels: labels.slice(0, maxLength), series };
}

function pickV1Series(data: any, kind: string): { labels: string[]; series: RenderableSeriesItem[] } {
  const points: Array<{ name: string; value: number }> =
    Array.isArray(data?.series) ? data.series : [];
  const labels = points.map((point) => String(point?.name ?? ""));
  const values = points.map((point) => {
    const n = Number(point?.value);
    return Number.isFinite(n) ? n : 0;
  });
  const renderAs: "bar" | "line" = /line|timeseries|trend/i.test(kind) || values.length > 12
    ? "line"
    : "bar";
  return {
    labels,
    series: [{ name: "Série", values, renderAs }],
  };
}

export function toRenderableSeries(payload: any): RenderableSeries {
  const isV2 = payload && payload.chart && Array.isArray(payload.chart.series);
  const chart = isV2 ? payload.chart : null;
  const kind = String(payload?.kind ?? chart?.type ?? "chart");
  const title = String(payload?.title ?? chart?.title ?? payload?.headline ?? "Meu Nino");

  const normalized = isV2
    ? pickV2Series(chart)
    : pickV1Series(payload?.data, kind);
  const primary = normalized.series[0] ?? { name: "Série", values: [], renderAs: "bar" as const };

  return {
    kind,
    title,
    labels: normalized.labels,
    values: primary.values,
    series: normalized.series,
    summary_text: payload?.summary_text ?? payload?.narrative,
    fallback_text: payload?.fallback_text ?? payload?.a11y_summary,
    formula_version: payload?.provenance?.formula_version,
    confidence: payload?.provenance?.confidence,
    row_count: payload?.provenance?.row_count,
    isLine: primary.renderAs === "line",
  };
}
