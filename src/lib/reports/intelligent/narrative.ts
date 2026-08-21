// Narrativa determinística: usada como base e como fallback quando a IA falha
// no guardrail numérico. Nunca cria número novo.
import { resultLineLabel, resultLineValue, resultSentence } from "@/lib/copy/resultWording";
import type { IntelligentReport } from "./types";

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));
const PCT = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function deterministicSummary(report: IntelligentReport): string {
  const t = report.payload.totals;
  const partial = report.payload.partial;
  const periodWord = report.reportType === "weekly" ? "semana" : report.reportType === "custom" ? "período" : "mês";
  const parts: string[] = [];
  if (partial) {
    parts.push(`Este é o retrato do mês em andamento: ${partial.daysElapsed} de ${partial.daysInMonth} dias já registrados.`);
  }
  parts.push(`No período de ${report.period.label} ${resultSentence(t.income, t.expense, periodWord)}.`);

  if (t.expenseDeltaPct !== null) {
    const base = partial
      ? `o mesmo intervalo de ${report.previousPeriod.label}`
      : report.previousPeriod.label;
    parts.push(
      `Comparando com ${base}, as despesas ${t.expenseDeltaPct >= 0 ? "subiram" : "caíram"} ${PCT(Math.abs(t.expenseDeltaPct))}.`,
    );
  }
  const top = report.payload.categories[0];
  if (top) {
    parts.push(`A maior categoria foi ${top.category}, com ${BRL(top.total)} (${PCT(top.share * 100)} do total).`);
  }
  if (t.daysWithExpense > 0) {
    parts.push(`Foram ${t.daysWithExpense} dias com gasto e média de ${BRL(t.dailyAvgExpense)} por dia ativo.`);
  }
  if (partial) {
    parts.push(`Mantido esse ritmo, o mês fecha perto de ${BRL(partial.projectedExpense)} de gasto — é projeção, não fato consumado.`);
  }
  parts.push(`Sua nota de saúde financeira deste ${periodWord} é ${report.healthScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} de 10.`);
  return parts.join(" ");
}


export function deterministicClosing(report: IntelligentReport): string {
  const first = report.highlights[0];
  if (!first) {
    return "Continue registrando os lançamentos para o próximo relatório trazer leituras mais precisas.";
  }
  return `Próximo passo sugerido: ${first.title.toLowerCase()}. ${first.body}`;
}

/** Mensagem curta de WhatsApp — sem parágrafos longos, com link do app. */
export function whatsappMessage(report: IntelligentReport, link: string | null): string {
  const t = report.payload.totals;
  const titulo = report.reportType === "weekly"
    ? `📊 Seu relatório da semana (${report.period.label})`
    : report.reportType === "monthly_partial"
      ? `📊 Seu mês até agora (${report.period.label})`
      : report.reportType === "custom"
        ? `📊 Seu relatório do período ${report.period.label}`
        : `📊 Seu relatório de ${report.period.label}`;

  const lines = [
    titulo,
    "",
    `Receitas: ${BRL(t.income)}`,
    `Gastos: ${BRL(t.expense)}`,
    `${resultLineLabel(t.income, t.expense)}: ${resultLineValue(t.income, t.expense)}`,

    `Nota de saúde: ${report.healthScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/10`,
  ];
  const first = report.highlights[0];
  if (first) {
    lines.push("", `Destaque: ${first.title}`);
  }
  if (link) {
    lines.push("", `Relatório completo: ${link}`);
  } else {
    lines.push("", "Abra o app em Mais › Relatórios inteligentes para ver o completo.");
  }
  return lines.join("\n");
}
