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

  // Consultas literais de total/frequência/ticket têm contratos próprios e não
  // dependem de existir um vencedor de comportamento típico.
  if (query.interpretation === "total_concentration") {
    const w = result.total_concentration_winner;
    if (!w) return `${prefix}Ainda não encontrei gastos suficientes nesse período.`;
    return `${prefix}${w.label} concentrou ${w.share_pct}% do valor gasto no período. Isso mede volume total, não seu comportamento típico.`;
  }
  if (query.interpretation === "frequency") {
    const w = result.frequency_winner;
    if (!w) return `${prefix}Ainda não há histórico suficiente para comparar a frequência de compras por dia da semana.`;
    return `${prefix}${w.label} é o dia com maior frequência de compras, com média de ${w.transactions_per_occurrence.toFixed(1).replace(".0", "")} transações por ocorrência.`;
  }
  if (query.interpretation === "average_ticket") {
    const w = result.ticket_winner;
    if (!w) return `${prefix}Ainda não há transações suficientes para calcular o ticket médio por dia da semana.`;
    return `${prefix}${w.label} tem o maior ticket médio, de ${BRL.format(w.average_ticket)} por compra.`;
  }

  // Regra P0: insufficient/candidate/ambiguous = ABSTENÇÃO. O modelo nunca
  // recebe autorização para transformar baixa confiança em uma conclusão.
  // Confiança baixa NÃO é motivo para não responder: entregamos a leitura
  // observada do período (fato) e sinalizamos que ainda não é padrão (juízo).
  const observed = result.weekdays
    .filter((row) => row.typical_amount > 0)
    .sort((x, y) => y.typical_amount - x.typical_amount)[0]
    ?? result.candidate
    ?? null;

  if (result.decision === "ambiguous") {
    const a = result.candidate;
    const b = result.weekdays
      .filter((row) => row.weekday !== a?.weekday && row.typical_amount > 0)
      .sort((x, y) => y.typical_amount - x.typical_amount)[0];
    if (a && b) {
      return `${prefix}${a.label} (${BRL.format(a.typical_amount)}) e ${b.label} (${BRL.format(b.typical_amount)}) estão praticamente empatados por ocorrência. `
        + `Pelo que já tenho, esses são os seus dois dias mais pesados — só não dá para eleger um padrão único ainda.`;
    }
    return `${prefix}Os dias líderes estão próximos demais para eu apontar um padrão semanal confiável.`;
  }
  if (result.decision !== "established" || !result.winner) {
    if (observed) {
      const total = result.total_concentration_winner;
      const extra = total && total.weekday !== observed.weekday
        ? ` No valor total, quem lidera é ${total.label} (${total.share_pct}%).`
        : "";
      return `${prefix}No histórico que tenho até agora, ${observed.label} aparece na frente, com cerca de `
        + `${BRL.format(observed.typical_amount)} por ocorrência.${extra} Ainda são poucas semanas para eu chamar isso de padrão seu.`;
    }
    const limitation = result.limitations[0];
    return `${prefix}Ainda não encontrei gastos registrados nesse período para comparar os dias da semana.${limitation ? ` ${limitation}` : ""}`;
  }

  const w = result.winner;
  let answer = `${prefix}considerando apenas gastos ajustáveis, datas comportamentais confiáveis e dias não excepcionais, ${w.label} é o seu dia de maior gasto típico, cerca de ${BRL.format(w.typical_amount)} por ocorrência.`;
  const total = result.total_concentration_winner;
  if (total && total.weekday !== w.weekday) {
    answer += ` Já ${total.label} lidera no valor total (${total.share_pct}%), que é uma métrica diferente do comportamento habitual.`;
  }
  if (result.excluded_low_confidence > 0) {
    answer += ` Desconsiderei ${result.excluded_low_confidence} lançamento${result.excluded_low_confidence > 1 ? "s" : ""} com data comportamental pouco confiável.`;
  }
  return answer;
}
