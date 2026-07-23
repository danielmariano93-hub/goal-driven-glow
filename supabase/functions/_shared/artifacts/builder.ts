// Monta ChartArtifact — contrato universal consumido pelo App (Recharts)
// e pelo WhatsApp (PNG server-side, quando habilitado). Nunca cria número:
// só empacota o resultado das ferramentas do motor analítico.
import type { Provenance } from "../analytics/provenance.ts";
import type { CompareResult } from "../analytics/compare.ts";
import type { ForecastResult } from "../analytics/forecast.ts";
import type { GoalProjection } from "../analytics/goals.ts";
import type { TimeseriesResult } from "../analytics/timeseries.ts";
import type { CumulativeDailyAverageResult } from "../analytics/dailyAverage.ts";

export type ChartType = "line" | "bar" | "stacked_bar" | "donut" | "area" | "progress" | "forecast_band";
export type ArtifactKind = "chart" | "report" | "goal_projection" | "forecast";

export type ChartArtifact = {
  kind: ArtifactKind;
  headline: string;
  narrative: string;
  metrics: Array<{ label: string; value: string; hint?: string }>;
  chart: {
    type: ChartType;
    title: string;
    x_labels: string[];
    series: Array<{ name: string; data: number[]; color?: string }>;
    units: "BRL" | "pct" | "count";
    annotations?: Array<{ x: string; label: string }>;
  };
  actions?: Array<{ label: string; intent: string; params?: Record<string, unknown> }>;
  provenance: Provenance;
  a11y_summary: string;
};

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const PCT = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;

export function buildCompareArtifact(cmp: CompareResult): ChartArtifact {
  const groups = cmp.by_group.slice(0, 6);
  const deltaLabel = cmp.delta_abs >= 0 ? "aumento" : "queda";
  const pctPart = cmp.delta_pct === null ? "" : ` (${PCT(cmp.delta_pct)})`;
  return {
    kind: "chart",
    headline: `Comparação de ${cmp.metric === "expense" ? "gastos" : "receita"}`,
    narrative: `${deltaLabel} de ${BRL(Math.abs(cmp.delta_abs))}${pctPart} entre os períodos.`,
    metrics: [
      { label: "Período A", value: BRL(cmp.total_a) },
      { label: "Período B", value: BRL(cmp.total_b) },
      { label: "Delta", value: BRL(cmp.delta_abs), hint: pctPart.trim() },
    ],
    chart: {
      type: "bar",
      title: "Por categoria",
      x_labels: groups.map(g => g.name),
      series: [
        { name: "Antes", data: groups.map(g => g.total_a) },
        { name: "Agora", data: groups.map(g => g.total_b) },
      ],
      units: "BRL",
    },
    provenance: cmp.provenance,
    a11y_summary: `Comparativo entre ${cmp.provenance.period.from} e ${cmp.provenance.period.to}: ${BRL(cmp.total_a)} vs ${BRL(cmp.total_b)}.`,
  };
}

export function buildForecastArtifact(f: ForecastResult): ChartArtifact {
  const days = f.drivers.days_in_month;
  const labels = Array.from({ length: days }, (_, i) => String(i + 1));
  // linha do gasto acumulado projetado (linear a partir de MTD)
  const dailyProj = f.point / days;
  const projSeries = Array.from({ length: days }, (_, i) => round2(dailyProj * (i + 1)));
  const observed = Array.from({ length: days }, (_, i) => i + 1 <= f.drivers.day_of_month
    ? round2((f.drivers.mtd_expense / f.drivers.day_of_month) * (i + 1))
    : NaN as unknown as number);

  return {
    kind: "forecast",
    headline: `Previsão de fechamento — ${f.month}`,
    narrative: `Estimo fechar o mês em torno de ${BRL(f.point)}${f.low && f.high ? ` (entre ${BRL(f.low)} e ${BRL(f.high)})` : ""}.`,
    metrics: [
      { label: "Previsão", value: BRL(f.point) },
      { label: "Gasto até hoje", value: BRL(f.drivers.mtd_expense) },
      { label: "Dia do mês", value: `${f.drivers.day_of_month}/${f.drivers.days_in_month}` },
      ...(f.backtest_summary ? [{ label: "Erro médio (backtest)", value: `${(f.backtest_summary.wape * 100).toFixed(0)}%` }] : []),
    ],
    chart: {
      type: "forecast_band",
      title: "Acumulado do mês",
      x_labels: labels,
      series: [
        { name: "Observado", data: observed },
        { name: "Projeção", data: projSeries },
      ],
      units: "BRL",
      annotations: [{ x: String(f.drivers.day_of_month), label: "hoje" }],
    },
    provenance: f.provenance,
    a11y_summary: `Previsão ${BRL(f.point)} com confiança ${f.provenance.confidence}.`,
  };
}

export function buildGoalArtifact(g: GoalProjection): ChartArtifact {
  const progress = g.target > 0 ? Math.min(1, g.current / g.target) : 0;
  return {
    kind: "goal_projection",
    headline: `Meta • ${g.name}`,
    narrative: g.projected_date
      ? `No ritmo atual (${BRL(g.observed_pace_month)}/mês), a meta fecha em ${g.projected_date}.`
      : `Ritmo insuficiente para projetar. Registre novos aportes.`,
    metrics: [
      { label: "Atual", value: BRL(g.current) },
      { label: "Alvo", value: BRL(g.target) },
      { label: "Faltam", value: BRL(g.remaining) },
      ...(g.required_pace_month ? [{ label: "Ritmo necessário", value: `${BRL(g.required_pace_month)}/mês` }] : []),
      { label: "Ritmo observado", value: `${BRL(g.observed_pace_month)}/mês` },
    ],
    chart: {
      type: "progress",
      title: "Progresso",
      x_labels: ["progresso"],
      series: [{ name: "pct", data: [round2(progress)] }],
      units: "pct",
    },
    provenance: g.provenance,
    a11y_summary: `Meta ${g.name}: ${(progress * 100).toFixed(0)}% concluída.`,
  };
}

export function buildTimeseriesArtifact(t: TimeseriesResult): ChartArtifact {
  const metricLabel = t.metric === "expense" ? "gastos" : "receitas";
  // dias em labels curtas "DD/MM"
  const shortLabels = t.labels.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
  return {
    kind: "chart",
    headline: `Evolução diária de ${metricLabel}`,
    narrative: `De ${t.from} a ${t.to}: ${BRL(t.total)} no total, média de ${BRL(t.daily_avg)} nos dias com movimento.`,
    metrics: [
      { label: "Total no período", value: BRL(t.total) },
      { label: "Média por dia ativo", value: BRL(t.daily_avg) },
      { label: "Dias observados", value: String(t.labels.length) },
    ],
    chart: {
      type: "line",
      title: "Diário e média móvel (7 dias)",
      x_labels: shortLabels,
      series: [
        { name: "Diário", data: t.daily, color: "#6D3BFF" },
        { name: "Média 7 dias", data: t.rolling7, color: "#FF9F1C" },
      ],
      units: "BRL",
    },
    provenance: t.provenance,
    a11y_summary: `Série diária de ${metricLabel} entre ${t.from} e ${t.to}. Total ${BRL(t.total)}.`,
  };
}

export function buildCumulativeDailyAverageArtifact(r: CumulativeDailyAverageResult): ChartArtifact {
  const shortLabels = r.labels.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
  const trendPctAbs = Math.abs(r.trend_change_pct);
  const trendLabel =
    r.trend === "falling" ? `↓ caindo ${(trendPctAbs * 100).toFixed(0)}% no período` :
    r.trend === "rising"  ? `↑ subindo ${(trendPctAbs * 100).toFixed(0)}% no período` :
                            "→ estável";
  const narrative =
    r.trend === "falling" ? `Sua média diária está caindo — de ${BRL(r.first_average)} para ${BRL(r.final_average)}.` :
    r.trend === "rising"  ? `Sua média diária está subindo — de ${BRL(r.first_average)} para ${BRL(r.final_average)}.` :
                            `Sua média diária está estável em torno de ${BRL(r.final_average)}.`;

  return {
    kind: "chart",
    headline: "Gasto médio diário acumulado",
    narrative,
    metrics: [
      { label: "Média atual", value: BRL(r.final_average) },
      { label: "Média inicial", value: BRL(r.first_average) },
      { label: "Variação", value: `${r.trend_change_pct >= 0 ? "+" : ""}${(r.trend_change_pct * 100).toFixed(1).replace(".", ",")}%`, hint: trendLabel },
      { label: "Dias observados", value: String(r.labels.length) },
    ],
    chart: {
      type: "line",
      title: "Média diária acumulada (R$/dia) e gasto do dia",
      x_labels: shortLabels,
      series: [
        { name: "Média diária acumulada", data: r.cumulative_average, color: "#6D3BFF" },
        { name: "Gasto do dia", data: r.daily, color: "#FF9F1C" },
      ],
      units: "BRL",
      annotations: [{ x: "__trend__", label: trendLabel }],
    },
    provenance: r.provenance,
    a11y_summary: `Média diária acumulada de ${r.from} a ${r.to}: ${BRL(r.final_average)}. Tendência: ${trendLabel}.`,
  };
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
