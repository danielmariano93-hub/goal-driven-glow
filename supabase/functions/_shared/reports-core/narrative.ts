// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v3)
// Narrativa determinística: usada como base e como fallback quando a IA falha
// no guardrail numérico. Nunca cria número novo.
import type { IntelligentReport } from "./types.ts";

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));
const PCT = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function deterministicSummary(report: IntelligentReport): string {
  const t = report.payload.totals;
  const periodWord = report.reportType === "weekly" ? "semana" : "mês";
  const parts: string[] = [];
  parts.push(
    `No período de ${report.period.label} você registrou ${BRL(t.income)} de receitas e ${BRL(t.expense)} de despesas, fechando ${t.net >= 0 ? "positivo" : "negativo"} em ${BRL(Math.abs(t.net))}.`,
  );
  if (t.expenseDeltaPct !== null) {
    parts.push(
      `Comparando com ${report.previousPeriod.label}, as despesas ${t.expenseDeltaPct >= 0 ? "subiram" : "caíram"} ${PCT(Math.abs(t.expenseDeltaPct))}.`,
    );
  }
  const top = report.payload.categories[0];
  if (top) {
    parts.push(`A maior categoria foi ${top.category}, com ${BRL(top.total)} (${PCT(top.share * 100)} do total).`);
  }
  if (t.daysWithExpense > 0) {
    parts.push(`Foram ${t.daysWithExpense} dias com gasto e média de ${BRL(t.dailyAvgExpense)} por dia ativo.`);
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
    : `📊 Seu relatório de ${report.period.label}`;
  const lines = [
    titulo,
    "",
    `Receitas: ${BRL(t.income)}`,
    `Despesas: ${BRL(t.expense)}`,
    `Resultado: ${BRL(t.net)}`,
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
