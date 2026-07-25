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
  if (!result.winner || result.confidence === "insufficient") {
    return `${prefix}Ainda não há histórico suficiente para afirmar em qual dia você normalmente gasta mais. Eu preciso de pelo menos quatro ocorrências comparáveis por dia da semana.`;
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

  let answer = `${prefix}Desconsiderando picos atípicos, ${w.label} é seu dia de maior gasto típico, em torno de ${BRL.format(w.typical_amount)} por ocorrência, ${confidenceText}.`;
  const total = result.total_concentration_winner;
  if (total && total.weekday !== w.weekday) {
    answer += ` Já ${total.label} lidera no valor total (${total.share_pct}%), mas esse resultado foi puxado por gastos fora do padrão.`;
  }
  if (result.limitations.length) answer += ` ${result.limitations[0]}`;
  return answer;
}
