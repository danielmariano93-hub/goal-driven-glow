// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Narrativa determinística: usada como base e como fallback quando a IA falha
// no guardrail numérico. Nunca cria número novo.
//
// `nino_comm.v1`: o nível 1 é uma CONCLUSÃO executiva de no máximo 3 frases e
// 3 números. Tudo que era enfileirado no parágrafo denso (dias com gasto,
// média por dia, projeção, nota) virou nível 2 em `deterministicDetails`.
import { resultLineLabel, resultLineValue, resultShape } from "../copy/resultWording.ts";
import { humanizeJargon } from "@/lib/copy/ninoVoice";
import type { IntelligentReport } from "./types.ts";

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));
/** Leitura: percentual sem casa decimal (nunca "60,47%" em headline). */
const PCT = (n: number) => `${Math.round(n).toLocaleString("pt-BR")}%`;
/** Prova/detalhe: mantém uma casa quando ela existe de fato. */
const PCT_EXACT = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function deterministicSummary(report: IntelligentReport): string {
  const t = report.payload.totals;
  const partial = report.payload.partial;
  const periodWord = report.reportType === "weekly" ? "semana" : report.reportType === "custom" ? "período" : "mês";
  const parts: string[] = [];

  // 1) Conclusão — o usuário precisa saber se está bem ou mal, com 1 número.
  const shape = resultShape(t.income, t.expense);
  const value = resultLineValue(t.income, t.expense);
  parts.push(
    shape === "gap"
      ? `Você gastou ${value} acima do que recebeu neste ${periodWord}.`
      : shape === "surplus"
        ? `Sobraram ${value} neste ${periodWord}.`
        : `Receitas e gastos empataram neste ${periodWord}.`,
  );

  // 2) Contexto — o que mudou em relação ao período anterior.
  if (t.expenseDeltaPct !== null) {
    const base = partial ? `o mesmo intervalo de ${report.previousPeriod.label}` : report.previousPeriod.label;
    parts.push(
      `Seus gastos ${t.expenseDeltaPct >= 0 ? "subiram" : "caíram"} ${PCT(Math.abs(t.expenseDeltaPct))} em relação a ${base}.`,
    );
  }

  // 3) Onde agir — o maior espaço de ajuste.
  const top = report.payload.categories[0];
  if (top) {
    parts.push(`O maior peso do período está em ${top.category}, com ${BRL(top.total)}.`);
  }

  return humanizeJargon(parts.slice(0, 3).join(" "));
}

/**
 * Nível 2 do relatório: fatos de apoio, um por linha, sob demanda.
 * Nenhum número novo — todos já existem no payload.
 */
export function deterministicDetails(report: IntelligentReport): string[] {
  const t = report.payload.totals;
  const partial = report.payload.partial;
  const periodWord = report.reportType === "weekly" ? "semana" : report.reportType === "custom" ? "período" : "mês";
  const lines: string[] = [];
  if (partial) lines.push(`Retrato do mês em andamento: ${partial.daysElapsed} de ${partial.daysInMonth} dias registrados.`);
  lines.push(`Recebido no período: ${BRL(t.income)}.`);
  lines.push(`Gasto no período: ${BRL(t.expense)}.`);
  lines.push(`${resultLineLabel(t.income, t.expense)}: ${resultLineValue(t.income, t.expense)}.`);
  const top = report.payload.categories[0];
  if (top) lines.push(`${top.category} representa ${PCT_EXACT(top.share * 100)} do total gasto.`);
  if (t.daysWithExpense > 0) {
    lines.push(`Foram ${t.daysWithExpense} dias com gasto, média de ${BRL(t.dailyAvgExpense)} por dia ativo.`);
  }
  if (partial) {
    lines.push(`Mantido esse ritmo, o ${periodWord} fecha perto de ${BRL(partial.projectedExpense)} de gasto — é projeção, não fato.`);
  }
  lines.push(`Nota de saúde financeira deste ${periodWord}: ${report.healthScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} de 10.`);
  return lines;
}


export function deterministicClosing(report: IntelligentReport): string {
  const first = report.highlights[0];
  if (!first) {
    return "Continue registrando os lançamentos para o próximo relatório trazer leituras mais precisas.";
  }
  return humanizeJargon(`Próximo passo: ${first.title.toLowerCase()}.`);
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
