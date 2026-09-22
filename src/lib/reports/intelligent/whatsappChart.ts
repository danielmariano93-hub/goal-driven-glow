import { exactBRL } from "@/lib/copy/numbers";
import type { IntelligentReport } from "./types";

export const REPORT_DAILY_CHART_VERSION = "financial_report.daily_combo.v1";

export function trailingAverage(values: number[], window = 7): number[] {
  return values.map((_, index) => {
    const from = Math.max(0, index - window + 1);
    const slice = values.slice(from, index + 1);
    const average = slice.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, slice.length);
    return Math.round((average + Number.EPSILON) * 100) / 100;
  });
}

export function monthlyChartCaption(report: IntelligentReport, link: string | null): string {
  const totals = report.payload.totals;
  const peak = report.payload.series.reduce<(typeof report.payload.series)[number] | null>(
    (best, point) => !best || point.expense > best.expense ? point : best,
    null,
  );
  const lines = [
    `📊 Gastos dia a dia · ${report.period.label}`,
    `• Total: ${exactBRL(totals.expense)} em ${totals.daysWithExpense} dias com gasto.`,
  ];
  if (peak && peak.expense > 0) {
    lines.push(`• Maior dia: ${exactBRL(peak.expense)} em ${peak.label}.`);
  }
  for (const highlight of report.highlights.slice(0, 2)) {
    lines.push(`• ${String(highlight.title).replace(/\.$/, "")}.`);
  }
  if (link) lines.push(`Veja os detalhes: ${link}`);
  return lines.join("\n").slice(0, 950);
}

export function buildMonthlyDailyChart(report: IntelligentReport, fallbackText: string) {
  const daily = report.payload.series.map((point) => Number(point.expense || 0));
  return {
    kind: "chart" as const,
    headline: `Gastos diários · ${report.period.label}`,
    summary_text: fallbackText,
    fallback_text: fallbackText,
    a11y_summary: `Gastos diários de ${report.period.start} a ${report.period.end}. Total de ${exactBRL(report.payload.totals.expense)}.`,
    chart: {
      type: "bar" as const,
      title: "Gasto diário e média móvel de 7 dias",
      x_labels: report.payload.series.map((point) => point.label),
      series: [
        { name: "Gasto diário", data: daily, color: "#6D3BFF", render_as: "bar" as const },
        { name: "Média de 7 dias", data: trailingAverage(daily, 7), color: "#FF9F1C", render_as: "line" as const },
      ],
      units: "BRL",
      y_format: "currency",
    },
    provenance: {
      formula_version: REPORT_DAILY_CHART_VERSION,
      row_count: report.payload.totals.transactionCount,
      confidence: report.dataQualityStatus === "ok" ? "high" as const : "medium" as const,
      source: "financial_reports",
      period: { from: report.period.start, to: report.period.end },
    },
  };
}
