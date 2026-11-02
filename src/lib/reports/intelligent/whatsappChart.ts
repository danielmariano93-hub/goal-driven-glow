import { exactBRL } from "@/lib/copy/numbers";
import {
  isRealMonthlyMovement,
  reportingCompetenceDate,
  type TransactionRow,
} from "@/lib/engine/facts";
import type { IntelligentReport } from "./types";

export const REPORT_DAILY_CHART_VERSION = "financial_report.daily_gross.v4";

export function trailingAverage(values: number[], window = 7): number[] {
  return values.map((_, index) => {
    const from = Math.max(0, index - window + 1);
    const slice = values.slice(from, index + 1);
    const average = slice.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, slice.length);
    return Math.round((average + Number.EPSILON) * 100) / 100;
  });
}

/** Compra no cartão e suas parcelas entram pelo mês da fatura: não têm "dia do gasto" no gráfico diário. */
const isCardSpend = (t: TransactionRow) => Boolean(t.credit_card_id) || String(t.payment_method ?? "") === "credit_card";

function inPeriodExpenses(report: IntelligentReport, transactions: TransactionRow[]) {
  return transactions
    .filter((t) => t.type === "expense" && isRealMonthlyMovement(t))
    .map((t) => ({ t, day: reportingCompetenceDate(t) }))
    .filter(({ day }) => day >= report.period.start && day <= report.period.end);
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Gasto bruto por dia, só do que tem data própria (conta, Pix, dinheiro). Cartão e parcelas ficam em bloco separado. */
export function grossDailySpend(report: IntelligentReport, transactions: TransactionRow[]): number[] {
  const byDay = new Map<string, number>();
  for (const { t, day } of inPeriodExpenses(report, transactions)) {
    if (isCardSpend(t)) continue;
    byDay.set(day, round2((byDay.get(day) ?? 0) + Number(t.amount || 0)));
  }
  return report.payload.series.map((point) => byDay.get(point.date) ?? 0);
}

/** Cartão e parcelas da competência (inclui parcelas antecipadas): somam no total do período, mas sem dia específico. */
export function cardCompetenceSpend(report: IntelligentReport, transactions: TransactionRow[]) {
  const rows = inPeriodExpenses(report, transactions).filter(({ t }) => isCardSpend(t));
  return { total: round2(rows.reduce((sum, { t }) => sum + Number(t.amount || 0), 0)), count: rows.length };
}

function chartSpendStats(report: IntelligentReport, transactions: TransactionRow[]) {
  const daily = grossDailySpend(report, transactions);
  const points = report.payload.series.map((point, index) => ({ ...point, expense: daily[index] ?? 0 }));
  const total = round2(daily.reduce((sum, value) => sum + value, 0));
  const card = cardCompetenceSpend(report, transactions);
  const daysWithExpense = daily.filter((value) => value > 0).length;
  const peak = points.reduce<(typeof points)[number] | null>(
    (best, point) => !best || point.expense > best.expense ? point : best,
    null,
  );
  return { daily, total, card, periodTotal: round2(total + card.total), daysWithExpense, peak };
}

export function monthlyChartCaption(
  report: IntelligentReport,
  link: string | null,
  transactions: TransactionRow[],
): string {
  const stats = chartSpendStats(report, transactions);
  const lines = [`📊 Gastos dia a dia · ${report.period.label}`];
  if (stats.total > 0) {
    lines.push(`• Gastos com data própria (conta, Pix, dinheiro): ${exactBRL(stats.total)} em ${stats.daysWithExpense} ${stats.daysWithExpense === 1 ? "dia" : "dias"}.`);
    if (stats.peak && stats.peak.expense > 0) lines.push(`• Maior dia: ${exactBRL(stats.peak.expense)} em ${stats.peak.label}.`);
  } else {
    lines.push("• Nenhum gasto com data própria no período.");
  }
  if (stats.card.total > 0) {
    lines.push(`• Cartão e parcelas do período: ${exactBRL(stats.card.total)} (entram pelo mês da fatura, sem um dia específico).`);
  }
  lines.push(`• Total do período: ${exactBRL(stats.periodTotal)}.`);
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
    a11y_summary: `Gastos diários brutos de ${report.period.start} a ${report.period.end}. Gastos com data própria: ${exactBRL(stats.total)}. Cartão e parcelas (${exactBRL(stats.card.total)}) entram pelo mês da fatura e não aparecem nas barras. Entradas e reembolsos não reduzem as barras.`,
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
