import type { ReportDetail, ReportHighlightRow } from "./client";
import { compactBRL, exactBRL, pct } from "@/lib/copy/numbers";
import { humanizeJargon, limitSentences } from "@/lib/copy/ninoVoice";
import { resultLineLabel, resultLineValue, resultShape } from "@/lib/copy/resultWording";

export type ReportReadingPresentation = {
  headline: string;
  context: string | null;
  nextStep: string | null;
  details: string[];
};

export type PresentedHighlight = {
  title: string;
  body: string;
};

function sentences(text: string | null | undefined): string[] {
  return humanizeJargon(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function periodWord(type: ReportDetail["report_type"]): string {
  if (type === "weekly") return "semana";
  if (type === "custom") return "período";
  return "mês";
}

function fallbackReading(report: ReportDetail): ReportReadingPresentation {
  const summary = sentences(report.executive_summary);
  const closing = sentences(report.closing_text);
  return {
    headline: summary[0] ?? "Continue registrando para o Nino ler seu período com mais precisão.",
    context: summary[1] ?? null,
    nextStep: closing[0] ?? summary[2] ?? null,
    details: [...summary.slice(2), ...closing.slice(1)].slice(0, 6),
  };
}

export function buildReportReading(report: ReportDetail): ReportReadingPresentation {
  const payload = report.payload;
  const totals = payload?.totals;
  if (!payload || !totals) return fallbackReading(report);

  const word = periodWord(report.report_type);
  const shape = resultShape(totals.income, totals.expense);
  const difference = Math.abs(Number(totals.income || 0) - Number(totals.expense || 0));
  const headline = shape === "gap"
    ? `Você gastou ${compactBRL(difference)} a mais do que recebeu neste ${word}.`
    : shape === "surplus"
      ? `Sobraram ${compactBRL(difference)} neste ${word}.`
      : `Receitas e gastos empataram neste ${word}.`;

  const base = payload.partial ? "o mesmo intervalo anterior" : "o período anterior";
  const context = totals.expenseDeltaPct === null
    ? null
    : totals.expenseDeltaPct < 0
      ? `A boa notícia é que seus gastos caíram ${pct(Math.abs(totals.expenseDeltaPct), "summary")} em relação a ${base}.`
      : `O sinal de atenção é que seus gastos subiram ${pct(totals.expenseDeltaPct, "summary")} em relação a ${base}.`;

  const flexible = Number(totals.flexibleTotal || 0);
  const top = payload.categories[0];
  const nextStep = flexible > 0
    ? `O maior espaço de ajuste está nos gastos que dão pra ajustar: ${compactBRL(flexible)}.`
    : top
      ? `O ponto que mais merece atenção é ${top.category}, com ${compactBRL(top.total)}.`
      : sentences(report.closing_text)[0] ?? "O próximo passo é manter os lançamentos em dia.";

  const details = [
    `Recebido no período: ${exactBRL(totals.income)}.`,
    `Gasto no período: ${exactBRL(totals.expense)}.`,
    `${resultLineLabel(totals.income, totals.expense)}: ${resultLineValue(totals.income, totals.expense)}.`,
    top ? `${top.category} concentrou ${pct(top.share * 100, "detail")} dos gastos.` : null,
    totals.daysWithExpense > 0 ? `Foram ${totals.daysWithExpense} dias com gasto, média de ${exactBRL(totals.dailyAvgExpense)} por dia ativo.` : null,
    payload.partial ? `Mantido esse ritmo, o mês pode fechar perto de ${exactBRL(payload.partial.projectedExpense)} em gastos.` : null,
    report.health_score !== null ? `Nota de saúde financeira: ${report.health_score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} de 10.` : null,
  ].filter((line): line is string => Boolean(line));

  return {
    headline: humanizeJargon(headline),
    context: context ? humanizeJargon(context) : null,
    nextStep: humanizeJargon(nextStep),
    details,
  };
}

function numberFromEvidence(evidence: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = evidence?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textFromEvidence(evidence: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = evidence?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function presentReportHighlight(highlight: ReportHighlightRow): PresentedHighlight {
  const evidence = highlight.evidence ?? null;
  const category = highlight.category ?? textFromEvidence(evidence, "category");
  const current = numberFromEvidence(evidence, "current");
  const previous = numberFromEvidence(evidence, "previous");
  const total = numberFromEvidence(evidence, "total");
  const income = numberFromEvidence(evidence, "income");
  const expense = numberFromEvidence(evidence, "expense");

  if (highlight.detector_key === "negative_result" && income !== null && expense !== null) {
    return {
      title: `Você gastou ${compactBRL(Math.abs(expense - income))} a mais do que recebeu.`,
      body: "O ajuste mais rápido costuma estar nos gastos que dão pra ajustar.",
    };
  }

  if (highlight.detector_key === "expense_spike" && current !== null && previous !== null) {
    return {
      title: "Seus gastos subiram em relação ao período anterior.",
      body: `Foram ${compactBRL(current)} agora, contra ${compactBRL(previous)} antes. Vale separar o que foi pontual do que virou rotina.`,
    };
  }

  if (highlight.detector_key === "uncategorized") {
    return {
      title: "Lançamentos sem categoria estão atrapalhando a leitura.",
      body: total ? `São ${compactBRL(total)} sem classificação. Antes de concluir que você gastou mais, vale organizar esses lançamentos.` : "Antes de concluir que você gastou mais, vale organizar esses lançamentos.",
    };
  }

  if (highlight.detector_key === "category_concentration" && category) {
    return {
      title: `${category} é onde seu mês mais se concentra.`,
      body: total ? `Foram ${compactBRL(total)} nesse grupo. Ajustar aqui muda mais o resultado do que cortar gastos pequenos espalhados.` : "Ajustar aqui muda mais o resultado do que cortar gastos pequenos espalhados.",
    };
  }

  if (highlight.detector_key === "category_growth" && category) {
    return {
      title: `${category} foi a mudança que mais chamou atenção.`,
      body: current !== null && previous !== null ? `Saiu de ${compactBRL(previous)} para ${compactBRL(current)}. Vale conferir se foi pontual ou uma mudança de hábito.` : "Vale conferir se foi pontual ou uma mudança de hábito.",
    };
  }

  if (highlight.detector_key === "flexible_saving" && category) {
    return {
      title: `Há espaço de ajuste em ${category}.`,
      body: humanizeJargon(highlight.body),
    };
  }

  if (highlight.detector_key === "card_over_cash") {
    return {
      title: "A fatura em aberto merece atenção.",
      body: humanizeJargon(highlight.body),
    };
  }

  const title = limitSentences(humanizeJargon(highlight.title), "card");
  const body = limitSentences(humanizeJargon(highlight.body), "card");
  return { title, body };
}