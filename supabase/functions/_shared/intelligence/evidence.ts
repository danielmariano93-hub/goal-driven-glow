import type { EvidencePackage, SemanticQuery } from "./contracts.ts";
import type { WeekdayPatternResult } from "../analytics/weekdayPattern.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function asEvidence(result: WeekdayPatternResult): EvidencePackage<WeekdayPatternResult> {
  return {
    metric_key: result.metric_key,
    formula_version: result.formula_version,
    period: result.period,
    sample_size: result.sample_size,
    confidence: result.confidence,
    result,
    exclusions: result.exclusions,
    outliers: result.outliers,
    limitations: result.limitations,
    generated_at: new Date().toISOString(),
  };
}

export function composeWeekdayPatternReply(result: WeekdayPatternResult, query: SemanticQuery): string {
  const prefix = query.correction ? "Você tem razão em separar padrão de um pico isolado. " : "";
  if (!result.winner) {
    return `${prefix}Ainda não há histórico suficiente para indicar em qual dia você normalmente gasta mais. Preciso de pelo menos duas ocorrências ativas comparáveis no dia candidato.`;
  }

  if (query.interpretation === "total_concentration") {
    const w = result.total_concentration_winner;
    if (!w) return "Ainda não encontrei gastos suficientes nesse período.";
    return `${prefix}${w.label} concentrou ${w.share_pct}% do valor gasto no período. Isso mede volume total, não necessariamente seu comportamento típico.`;
  }

  if (query.interpretation === "frequency") {
    const w = result.frequency_winner;
    if (!w) return "Ainda não há transações suficientes para comparar a frequência por dia da semana.";
    return `${prefix}${w.label} é o dia em que você faz mais compras, com média de ${w.transactions_per_occurrence.toFixed(1).replace(".0", "")} transações por ocorrência.`;
  }

  if (query.interpretation === "average_ticket") {
    const w = result.ticket_winner;
    if (!w) return "Ainda não há transações suficientes para calcular o ticket médio por dia da semana.";
    return `${prefix}${w.label} tem o maior ticket médio, de ${BRL.format(w.average_ticket)} por compra.`;
  }

  const w = result.winner;
  const confidenceText = result.confidence === "high"
    ? "com boa confiança"
    : result.confidence === "medium"
      ? "como um sinal consistente"
      : "como um sinal inicial";

  let answer = `${prefix}${result.provisional ? "Como sinal preliminar — ainda não como conclusão — " : ""}considerando a frequência com que você gasta e os valores típicos, ${w.label} é o dia de maior gasto esperado, cerca de ${BRL.format(w.typical_amount)} por ${w.label.toLowerCase()} no período, ${confidenceText}.`;
  const total = result.total_concentration_winner;
  if (total && total.weekday !== w.weekday) {
    const pulledByOutlier = result.outliers.some((o) => o.weekday === total.weekday);
    answer += pulledByOutlier
      ? ` Já ${total.label} lidera no valor total (${total.share_pct}%), mas esse resultado foi puxado por um gasto fora do padrão.`
      : ` Já ${total.label} lidera no valor total (${total.share_pct}%), uma métrica diferente do comportamento habitual.`;
  }
  if (result.limitations.length) answer += ` ${result.limitations[0]}`;
  if (result.excluded_low_confidence > 0) {
    answer += ` Desconsiderei ${result.excluded_low_confidence} lançamento${result.excluded_low_confidence > 1 ? "s" : ""} cuja data parece ser apenas a postagem bancária, para não atribuir ao dia errado.`;
  }
  return answer;
}
