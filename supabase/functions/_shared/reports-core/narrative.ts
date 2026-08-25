// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Narrativa determinística: usada como base e como fallback quando a IA falha
// no guardrail numérico. Nunca cria número novo.
//
// `nino_comm.v1`: o nível 1 é uma CONCLUSÃO executiva de no máximo 3 frases e
// 3 números. Tudo que era enfileirado no parágrafo denso (dias com gasto,
// média por dia, projeção, nota) virou nível 2 em `deterministicDetails`.
import { compactBRL, exactBRL, pct } from "../copy/numbers.ts";
import { resultLineLabel, resultLineValue, resultShape } from "../copy/resultWording.ts";
import { humanizeJargon } from "../copy/ninoVoice.ts";
import type { IntelligentReport } from "./types.ts";

export function deterministicSummary(report: IntelligentReport): string {
  const t = report.payload.totals;
  const partial = report.payload.partial;
  const periodWord = report.reportType === "weekly" ? "semana" : report.reportType === "custom" ? "período" : "mês";
  const parts: string[] = [];

  // 1) Conclusão — o usuário precisa saber se está bem ou mal, com 1 número.
  const shape = resultShape(t.income, t.expense);
  const value = compactBRL(Math.abs(Number(t.income || 0) - Number(t.expense || 0)));
  parts.push(
    shape === "gap"
      ? `Você gastou ${value} acima do que recebeu neste ${periodWord}.`
      : shape === "surplus"
        ? `Sobraram ${value} neste ${periodWord}.`
        : `Receitas e gastos empataram neste ${periodWord}.`,
  );

  // 2) Contexto — o que mudou em relação ao período anterior.
  if (t.expenseDeltaPct !== null) {
    const base = partial ? "o mesmo intervalo anterior" : "o período anterior";
    parts.push(
      t.expenseDeltaPct >= 0
        ? `O sinal de atenção é que seus gastos subiram ${pct(Math.abs(t.expenseDeltaPct), "summary")} em relação a ${base}.`
        : `A boa notícia é que seus gastos caíram ${pct(Math.abs(t.expenseDeltaPct), "summary")} em relação a ${base}.`,
    );
  }

  // 3) Onde agir — o maior espaço de ajuste.
  if (t.flexibleTotal > 0) {
    parts.push(`O maior espaço de ajuste está nos gastos que dão pra ajustar: ${compactBRL(t.flexibleTotal)}.`);
  } else {
    const top = report.payload.categories[0];
    if (top) parts.push(`O ponto que mais merece atenção é ${top.category}, com ${compactBRL(top.total)}.`);
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
  lines.push(`Recebido no período: ${exactBRL(t.income)}.`);
  lines.push(`Gasto no período: ${exactBRL(t.expense)}.`);
  lines.push(`${resultLineLabel(t.income, t.expense)}: ${resultLineValue(t.income, t.expense)}.`);
  const top = report.payload.categories[0];
  if (top) lines.push(`${top.category} representa ${pct(top.share * 100, "detail")} do total gasto.`);
  if (t.daysWithExpense > 0) {
    lines.push(`Foram ${t.daysWithExpense} dias com gasto, média de ${exactBRL(t.dailyAvgExpense)} por dia ativo.`);
  }
  if (partial) {
    lines.push(`Mantido esse ritmo, o ${periodWord} pode fechar perto de ${exactBRL(partial.projectedExpense)} em gastos.`);
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
  const word = report.reportType === "weekly" ? "semana" : report.reportType === "custom" ? "período" : "mês";
  const shape = resultShape(t.income, t.expense);
  const difference = Math.abs(Number(t.income || 0) - Number(t.expense || 0));
  const firstLine = shape === "gap"
    ? `Você gastou ${compactBRL(difference)} a mais do que recebeu neste ${word}.`
    : shape === "surplus"
      ? `Sobraram ${compactBRL(difference)} neste ${word}.`
      : `Receitas e gastos empataram neste ${word}.`;
  const lines = [firstLine];
  if (t.expenseDeltaPct !== null) {
    lines.push(t.expenseDeltaPct >= 0
      ? `Os gastos subiram ${pct(Math.abs(t.expenseDeltaPct), "summary")} em relação ao período anterior.`
      : `A boa notícia é que os gastos caíram ${pct(Math.abs(t.expenseDeltaPct), "summary")} em relação ao período anterior.`);
  }
  const first = report.highlights[0];
  if (first) {
    lines.push(`O ponto principal agora: ${humanizeJargon(first.title).replace(/\.$/, "")}.`);
  }
  if (link) {
    lines.push(`Quer ver o detalhe? ${link}`);
  } else {
    lines.push("Quer revisar pelo app?");
  }
  return lines.slice(0, 4).join("\n");
}
