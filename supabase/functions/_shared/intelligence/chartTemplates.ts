// chartTemplates (`nino_chart_templates.v1`)
// deno-lint-ignore-file no-explicit-any
//
// Gráfico de série = TEMPLATE por grão + DADOS executados + PERÍODO e recorte.
// O Nino só decide o grão (dia, semana, mês, trimestre); o template define
// título, eixo, rótulos e legenda, e é preenchido exclusivamente com a evidência
// do motor determinístico. Nada é recalculado aqui.
import { buildMonthlySeriesChartArtifact } from "./monthlySeriesChart.ts";
import type { MonthlySpendingSeriesResult } from "../agent/core/handlers/MonthlySeriesHandler.ts";
import {
  isScopedSeriesResult,
  pointDisplayLabel,
  scopedSeriesScopeLabel,
  type ScopedSeriesResult,
} from "../agent/core/handlers/ScopedSeriesHandler.ts";
import type { ScopedSeriesGrain, SeriesGrain } from "../agent/core/SeriesGrain.ts";

export type SeriesChartTemplate = {
  grain: SeriesGrain;
  /** Título do gráfico: "Gastos dia a dia · Transporte no Uber". */
  title: string;
  /** Nome da série de barras. */
  bar_name: string;
  /** Nome do ponto de pico na legenda. */
  peak: string;
  /** Contagem de pontos com gasto. */
  units: string;
  tool_name: string;
};

export const SERIES_CHART_TEMPLATES: Record<SeriesGrain, SeriesChartTemplate> = {
  day: { grain: "day", title: "Gastos dia a dia", bar_name: "Gasto do dia", peak: "Maior dia", units: "Dias com gasto", tool_name: "generate_daily_series_chart_artifact" },
  week: { grain: "week", title: "Gastos semana a semana", bar_name: "Gasto da semana", peak: "Maior semana", units: "Semanas com gasto", tool_name: "generate_weekly_series_chart_artifact" },
  month: { grain: "month", title: "Gastos mês a mês", bar_name: "Gasto mensal", peak: "Maior mês", units: "Meses com gasto", tool_name: "generate_monthly_series_chart_artifact" },
  quarter: { grain: "quarter", title: "Gastos por trimestre", bar_name: "Gasto do trimestre", peak: "Maior trimestre", units: "Trimestres com gasto", tool_name: "generate_quarterly_series_chart_artifact" },
};

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", {
  style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const ddmm = (ymd: string) => `${String(ymd).slice(8, 10)}/${String(ymd).slice(5, 7)}`;
const ddmmyyyy = (ymd: string) => `${ddmm(ymd)}/${String(ymd).slice(0, 4)}`;
const launches = (n: number) => `${n} ${n === 1 ? "lançamento" : "lançamentos"}`;

export function scopedSeriesChartCaption(result: ScopedSeriesResult): string {
  const template = SERIES_CHART_TEMPLATES[result.grain];
  const lines = [
    `📊 ${template.title} · ${scopedSeriesScopeLabel(result)}`,
    `• Período: ${ddmm(result.window.from)} a ${ddmm(result.window.to)}.`,
    `• Total gasto: ${brl(result.total)} em ${launches(result.transaction_count)}.`,
    `• ${template.units}: ${result.active_points} de ${result.window.n}.`,
  ];
  if (result.peak) lines.push(`• ${template.peak}: ${pointDisplayLabel(result.grain, result.peak)}, com ${brl(result.peak.total)}.`);
  return lines.join("\n").slice(0, 950);
}

/** Template dia/semana/trimestre preenchido com a série executada. */
export function buildScopedSeriesChartArtifact(result: ScopedSeriesResult) {
  const template = SERIES_CHART_TEMPLATES[result.grain];
  const scope = scopedSeriesScopeLabel(result);
  const caption = scopedSeriesChartCaption(result);
  return {
    kind: "chart" as const,
    title: `${template.title} · ${scope}`,
    headline: `${template.title} · ${scope}`,
    summary_text: caption,
    fallback_text: caption,
    a11y_summary: `${template.title} em ${scope}, de ${ddmmyyyy(result.window.from)} a ${ddmmyyyy(result.window.to)}. Total ${brl(result.total)}.`,
    narrative: `De ${ddmm(result.window.from)} a ${ddmm(result.window.to)}: ${brl(result.total)} em ${launches(result.transaction_count)}.`,
    metrics: [
      { label: "Total no período", value: brl(result.total) },
      { label: template.units, value: `${result.active_points} de ${result.window.n}` },
      ...(result.peak ? [{ label: template.peak, value: `${pointDisplayLabel(result.grain, result.peak)} · ${brl(result.peak.total)}` }] : []),
    ],
    chart: {
      type: "bar" as const,
      title: template.bar_name,
      x_labels: result.points.map((point) => point.label),
      series: [
        { name: template.bar_name, data: result.points.map((point) => Number(point.total ?? 0)), color: "#6D3BFF", render_as: "bar" as const },
      ],
      units: "BRL" as const,
      y_format: "currency",
    },
    provenance: {
      formula_version: result.formula_version,
      row_count: result.transaction_count,
      confidence: "high" as const,
      source: result.version,
      as_of: new Date().toISOString(),
      period: { from: result.window.from, to: result.window.to, tz: "America/Sao_Paulo" as const },
    },
  };
}

function monthlyMetrics(result: MonthlySpendingSeriesResult) {
  const withData = result.months.filter((point) => point.has_data);
  const peak = withData.reduce<(typeof withData)[number] | null>((best, p) => !best || p.total > best.total ? p : best, null);
  return [
    { label: "Total no período", value: brl(result.total) },
    { label: "Meses com gasto", value: `${withData.length} de ${result.months.length}` },
    ...(peak ? [{ label: "Maior mês", value: `${peak.month.slice(5, 7)}/${peak.month.slice(2, 4)} · ${brl(peak.total)}` }] : []),
  ];
}

function isMonthlySeriesResult(value: unknown): value is MonthlySpendingSeriesResult {
  const r = value as MonthlySpendingSeriesResult | null;
  return !!r && r.version === "nino_monthly_series.v1" && Array.isArray(r.months);
}

/** Grão de uma evidência de série executada, ou null se não for série. */
export function seriesEvidenceGrain(result: unknown): SeriesGrain | null {
  if (isMonthlySeriesResult(result)) return "month";
  if (isScopedSeriesResult(result)) return result.grain as ScopedSeriesGrain;
  return null;
}

export function seriesEvidenceHasData(result: unknown): boolean {
  if (isMonthlySeriesResult(result)) return result.months.some((point) => point.has_data);
  if (isScopedSeriesResult(result)) return result.active_points > 0;
  return false;
}

/**
 * Contrato do ChartArtifact que o app renderiza (src/types/artifacts.ts):
 * headline, narrative, metrics[], chart{x_labels, series[]}, provenance{period
 * {from,to,tz}, as_of, row_count, confidence, formula_version}. Qualquer payload
 * de gráfico passa por aqui antes de ser gravado: campo ausente derrubava a tela
 * inteira do assessor no app.
 */
export function completeChartContract<T extends Record<string, any>>(payload: T): T {
  const summary = String(payload?.summary_text ?? payload?.fallback_text ?? "");
  const summaryLines = summary.split("\n").map((line) => line.replace(/^[•📊\s]+/u, "").trim()).filter(Boolean);
  const provenance = (payload?.provenance ?? {}) as Record<string, any>;
  const chart = (payload?.chart ?? null) as Record<string, any> | null;
  return {
    ...payload,
    headline: String(payload?.headline ?? payload?.title ?? "Gráfico"),
    narrative: String(payload?.narrative ?? summaryLines[1] ?? summaryLines[0] ?? ""),
    metrics: Array.isArray(payload?.metrics) ? payload.metrics : [],
    ...(chart
      ? {
        chart: {
          ...chart,
          x_labels: Array.isArray(chart.x_labels) ? chart.x_labels : [],
          series: Array.isArray(chart.series) ? chart.series : [],
          units: chart.units ?? "BRL",
        },
      }
      : {}),
    provenance: {
      ...provenance,
      as_of: provenance.as_of ?? new Date().toISOString(),
      confidence: provenance.confidence ?? "medium",
      row_count: Number(provenance.row_count ?? 0),
      formula_version: String(provenance.formula_version ?? "artifact.v2"),
      period: { ...(provenance.period ?? {}), tz: provenance.period?.tz ?? "America/Sao_Paulo" },
    },
  };
}

export type SeriesChart = {
  grain: SeriesGrain;
  template: SeriesChartTemplate;
  payload: ReturnType<typeof buildScopedSeriesChartArtifact> | ReturnType<typeof buildMonthlySeriesChartArtifact>;
};

/**
 * Único ponto que transforma evidência de série em gráfico. Se o grão pedido
 * não for o grão executado, não há gráfico: nunca desenhar outra pergunta.
 */
export function seriesChartFromEvidence(result: unknown, requestedGrain: SeriesGrain | null = null): SeriesChart | null {
  const grain = seriesEvidenceGrain(result);
  if (!grain || !seriesEvidenceHasData(result)) return null;
  if (requestedGrain && requestedGrain !== grain) return null;
  const template = SERIES_CHART_TEMPLATES[grain];
  const payload = isMonthlySeriesResult(result)
    ? {
      ...buildMonthlySeriesChartArtifact(result),
      narrative: `De ${ddmm(result.window.from)} a ${ddmm(result.window.to)}: ${brl(result.total)} em ${launches(result.transaction_count)}.`,
      metrics: monthlyMetrics(result),
    }
    : buildScopedSeriesChartArtifact(result as ScopedSeriesResult);
  return { grain, template, payload: completeChartContract(payload) };
}

type CallLike = {
  step_index: number;
  tool_name: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  duration_ms: number;
  error: string | null;
};

/**
 * Evidência do turno para o gráfico: a linha gravada vale, mas se ela estiver
 * sem resultado (ou ausente) usa-se o resultado EXATO executado em memória.
 * Foi a gravação `result: null` da série diária que deixou o gráfico sem dados
 * em produção (30/09).
 */
export function mergeExecutedSeriesEvidence<T extends CallLike>(
  stored: T[],
  executed: Array<{ tool_name: string; args?: unknown; result: unknown; ok: boolean }> | null | undefined,
): T[] {
  const calls = stored.map((call) => ({ ...call }));
  for (const call of executed ?? []) {
    if (!call.ok || seriesEvidenceGrain(call.result) === null) continue;
    const match = calls.find((existing) => existing.tool_name === call.tool_name);
    if (match) {
      if (match.result == null || seriesEvidenceGrain(match.result) === null) {
        match.result = call.result;
        match.ok = true;
      }
      continue;
    }
    calls.push({
      step_index: calls.length,
      tool_name: call.tool_name,
      args: call.args ?? {},
      result: call.result,
      ok: true,
      duration_ms: 0,
      error: null,
    } as T);
  }
  return calls;
}
