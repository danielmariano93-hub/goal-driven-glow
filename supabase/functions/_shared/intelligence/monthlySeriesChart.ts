// Pure presentation adapter for the deterministic monthly spending series.
// It never recalculates financial facts: totals/counts come from
// nino_monthly_series.v1. The only derived visual series is a trailing average.
import type { MonthlySpendingSeriesResult } from "../agent/core/handlers/MonthlySeriesHandler.ts";

const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function brl(value: number): string {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDatePt(ymd: string): string {
  const [year, month, day] = String(ymd).split("-");
  return `${day}/${month}/${year}`;
}

function monthShort(month: string): string {
  const [year, mm] = String(month).split("-").map(Number);
  return `${MONTHS_SHORT[mm - 1] ?? String(mm).padStart(2, "0")}/${String(year).slice(-2)}`;
}

function monthLong(month: string): string {
  const mm = Number(String(month).slice(5, 7));
  return MONTHS_LONG[mm - 1] ?? month;
}

function scopeLabel(result: MonthlySpendingSeriesResult): string {
  const category = String(result.scope.category ?? "").trim();
  const merchant = String(result.scope.merchant ?? "").trim();
  if (category && merchant) return `${category} com ${merchant}`;
  if (category) return category;
  if (merchant) return merchant;
  return "todos os gastos";
}

function trailingAverage(values: number[], window = 3): number[] {
  return values.map((_, index) => {
    const from = Math.max(0, index - window + 1);
    const slice = values.slice(from, index + 1);
    const average = slice.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, slice.length);
    return Math.round((average + Number.EPSILON) * 100) / 100;
  });
}

function launchCount(count: number): string {
  return `${count} ${count === 1 ? "lançamento" : "lançamentos"}`;
}

export function monthlySeriesChartCaption(result: MonthlySpendingSeriesResult): string {
  const monthsWithData = result.months.filter((point) => point.has_data);
  const peak = monthsWithData.reduce<(typeof monthsWithData)[number] | null>(
    (best, point) => !best || point.total > best.total ? point : best,
    null,
  );
  const average = result.total / Math.max(1, result.months.length);
  const lines = [
    `📊 Gastos mês a mês · ${scopeLabel(result)}`,
    `• Período: ${formatDatePt(result.window.from)} a ${formatDatePt(result.window.to)}.`,
    `• Total gasto: ${brl(result.total)} em ${launchCount(result.transaction_count)}.`,
  ];
  if (peak) lines.push(`• Maior mês: ${brl(peak.total)} em ${monthLong(peak.month).toLowerCase()}.`);
  lines.push(`• Média mensal: ${brl(average)}.`);
  if (result.partial_last_month && result.months.length) {
    const last = result.months[result.months.length - 1];
    const cutoff = formatDatePt(result.window.to).slice(0, 5);
    lines.push(`• ${monthLong(last.month)} está parcial: considerado até ${cutoff}.`);
  }
  if (result.partial_first_month && result.months.length) {
    const first = result.months[0];
    const start = formatDatePt(result.window.from).slice(0, 5);
    lines.push(`• ${monthLong(first.month)} também está parcial: considerado a partir de ${start}.`);
  }
  return lines.join("\n").slice(0, 950);
}

export function buildMonthlySeriesChartArtifact(result: MonthlySpendingSeriesResult) {
  const labels = result.months.map((point) => monthShort(point.month));
  const values = result.months.map((point) => Number(point.total ?? 0));
  const caption = monthlySeriesChartCaption(result);
  const movingWindow = Math.min(3, Math.max(1, values.length));
  return {
    kind: "chart" as const,
    title: `Gastos mês a mês · ${scopeLabel(result)}`,
    headline: `Gastos mês a mês · ${scopeLabel(result)}`,
    summary_text: caption,
    fallback_text: caption,
    a11y_summary: `Série mensal de gastos em ${scopeLabel(result)}, de ${formatDatePt(result.window.from)} a ${formatDatePt(result.window.to)}. Total ${brl(result.total)}.`,
    chart: {
      type: "bar" as const,
      title: `Gasto mensal e média móvel de ${movingWindow} ${movingWindow === 1 ? "mês" : "meses"}`,
      x_labels: labels,
      series: [
        { name: "Gasto mensal", data: values, color: "#6D3BFF", render_as: "bar" as const },
        { name: `Média de ${movingWindow} ${movingWindow === 1 ? "mês" : "meses"}`, data: trailingAverage(values, movingWindow), color: "#FF9F1C", render_as: "line" as const },
      ],
      units: "BRL" as const,
      y_format: "currency",
    },
    provenance: {
      formula_version: result.formula_version,
      row_count: result.transaction_count,
      confidence: "high" as const,
      source: "nino_monthly_series.v1",
      period: { from: result.window.from, to: result.window.to },
    },
  };
}
