// Monta ChartArtifact — contrato universal consumido pelo App (Recharts)
// e pelo WhatsApp (PNG server-side, quando habilitado). Nunca cria número:
// só empacota o resultado das ferramentas do motor analítico.
import type { Provenance } from "../analytics/provenance.ts";
import type { CompareResult } from "../analytics/compare.ts";
import type { ForecastResult } from "../analytics/forecast.ts";
import type { GoalProjection } from "../analytics/goals.ts";

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

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
