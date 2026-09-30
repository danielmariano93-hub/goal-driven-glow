import type { ChartArtifact, ChartType, Confidence } from "@/types/artifacts";

type Json = Record<string, unknown>;

const CHART_TYPES: readonly ChartType[] = ["line", "bar", "stacked_bar", "donut", "area", "progress", "forecast_band"];
const CONFIDENCE: readonly Confidence[] = ["high", "medium", "low", "insufficient_data"];
const KINDS: readonly ChartArtifact["kind"][] = ["chart", "report", "goal_projection", "forecast"];

const obj = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? value as T : fallback;

/**
 * O payload vem do banco (agent_artifacts) e pode ser de qualquer versão do
 * motor. A tela nunca pode quebrar por causa de um campo ausente: normaliza
 * para o contrato ChartArtifact ou devolve null (não renderiza o gráfico).
 */
export function normalizeChartArtifact(raw: unknown): ChartArtifact | null {
  const payload = obj(raw);
  const chart = obj(payload?.chart);
  if (!payload || !chart) return null;

  const x_labels = list(chart.x_labels).map((label) => String(label ?? ""));
  const series = list(chart.series).flatMap((entry, index) => {
    const s = obj(entry);
    if (!s) return [];
    return [{
      name: text(s.name) || `Série ${index + 1}`,
      data: list(s.data).map(num),
      ...(typeof s.color === "string" ? { color: s.color } : {}),
    }];
  });
  if (!x_labels.length || !series.length) return null;

  const provenance = obj(payload.provenance) ?? {};
  const period = obj(provenance.period) ?? {};
  const annotations = list(chart.annotations).flatMap((entry) => {
    const a = obj(entry);
    return a ? [{ x: text(a.x), label: text(a.label) }] : [];
  });

  return {
    kind: oneOf(KINDS, payload.kind, "chart"),
    headline: text(payload.headline) || text(payload.title) || text(chart.title) || "Gráfico",
    narrative: text(payload.narrative),
    metrics: list(payload.metrics).flatMap((entry) => {
      const m = obj(entry);
      return m ? [{ label: text(m.label), value: text(m.value) || String(m.value ?? "") }] : [];
    }),
    chart: {
      type: oneOf(CHART_TYPES, chart.type, "bar"),
      title: text(chart.title),
      x_labels,
      series,
      units: oneOf(["BRL", "pct", "count"] as const, chart.units, "BRL"),
      ...(annotations.length ? { annotations } : {}),
    },
    provenance: {
      period: { from: text(period.from), to: text(period.to), tz: "America/Sao_Paulo" },
      as_of: text(provenance.as_of),
      row_count: num(provenance.row_count),
      confidence: oneOf(CONFIDENCE, provenance.confidence, "medium"),
      formula_version: text(provenance.formula_version),
    },
    a11y_summary: text(payload.a11y_summary),
  };
}
