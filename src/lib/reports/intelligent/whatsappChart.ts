import { exactBRL } from "@/lib/copy/numbers";
import {
  isRealMonthlyMovement,
  reportingCompetenceDate,
  type TransactionRow,
} from "@/lib/engine/facts";
import type { IntelligentReport } from "./types";

export const REPORT_DAILY_CHART_VERSION = "financial_report.daily_gross.v2";

export function trailingAverage(values: number[], window = 7): number[] {
  return values.map((_, index) => {
    const from = Math.max(0, index - window + 1);
    const slice = values.slice(from, index + 1);
    const average = slice.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, slice.length);
    return Math.round((average + Number.EPSILON) * 100) / 100;
  });
}

export function grossDailySpend(report: IntelligentReport, transactions: TransactionRow[]): number[] {
  const byDay = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== "expense" || !isRealMonthlyMovement(transaction)) continue;
    const day = reportingCompetenceDate(transaction);
    if (day < report.period.start || day > report.period.end) continue;
    byDay.set(day, Math.round(((byDay.get(day) ?? 0) + Number(transaction.amount || 0)) * 100) / 100);
  }
  return report.payload.series.map((point) => byDay.get(point.date) ?? 0);
}

function chartSpendStats(report: IntelligentReport, transactions: TransactionRow[]) {
  const daily = grossDailySpend(report, transactions);
  const points = report.payload.series.map((point, index) => ({ ...point, expense: daily[index] ?? 0 }));
  const total = Math.round(daily.reduce((sum, value) => sum + value, 0) * 100) / 100;
  const daysWithExpense = daily.filter((value) => value > 0).length;
  const peak = points.reduce<(typeof points)[number] | null>(
    (best, point) => !best || point.expense > best.expense ? point : best,
    null,
  );
  return { daily, total, daysWithExpense, peak };
}

export function monthlyChartCaption(
  report: IntelligentReport,
  link: string | null,
  transactions: TransactionRow[],
): string {
  const stats = chartSpendStats(report, transactions);
  const lines = [
    `📊 Gastos dia a dia · ${report.period.label}`,
    `• Total gasto: ${exactBRL(stats.total)} em ${stats.daysWithExpense} dias.`,
  ];
  if (stats.peak && stats.peak.expense > 0) {
    lines.push(`• Maior dia: ${exactBRL(stats.peak.expense)} em ${stats.peak.label}.`);
  }
  for (const highlight of report.highlights.slice(0, 2)) {
    lines.push(`• ${String(highlight.title).replace(/\.$/, "")}.`);
  }
  if (link) lines.push(`Veja os detalhes: ${link}`);
  return lines.join("\n").slice(0, 950);
}

export function buildMonthlyDailyChart(
  report: IntelligentReport,
  fallbackText: string,
  transactions: TransactionRow[],
) {
  const stats = chartSpendStats(report, transactions);
  const daily = stats.daily;
  return {
    kind: "chart" as const,
    headline: `Gastos diários · ${report.period.label}`,
    summary_text: fallbackText,
    fallback_text: fallbackText,
    a11y_summary: `Gastos diários brutos de ${report.period.start} a ${report.period.end}. Total de ${exactBRL(stats.total)}. Entradas e reembolsos não reduzem as barras.`,
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
      source: "transactions_gross_expense",
      period: { from: report.period.start, to: report.period.end },
    },
  };
}
