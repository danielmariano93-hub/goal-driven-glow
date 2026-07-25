import type { SemanticQuery } from "./contracts.ts";

function normalize(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function outputMode(t: string): SemanticQuery["output"] {
  const visual = /\b(grafico|chart|visual|linha|barras?|pizza|donut)\b/.test(t);
  return visual ? "both" : "text";
}

export function isInterpretationCorrection(text: string): boolean {
  const t = normalize(text);
  return /\b(nao foi isso|nao e isso|nao era isso|eu digo|quero dizer|na media|sem considerar|tirando|desconsiderando|sem picos|sem outliers)\b/.test(t);
}

function isDirectSingleWeekdayLookup(t: string): boolean {
  const namedWeekday = /\b(segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b/.test(t);
  const directAmount = /\b(quanto|qual valor|total|soma|gastei|gasto|gastos|despesa|despesas)\b/.test(t);
  const comparison = /\b(qual dia|que dia|em qual dia|dia da semana|mais gasto|gasto mais|maior gasto|concentrou mais|mais vezes|frequencia|padrao|geralmente|normalmente|costumo|tipicamente|habitual)\b/.test(t);
  return namedWeekday && directAmount && !comparison;
}

/**
 * Interpreta apenas perguntas comparativas/de padrão por dia da semana.
 * Consultas literais como "quanto gastei na sexta?" ficam fora desta rota.
 *
 * `contextText` é usado somente quando a mensagem atual é uma correção curta,
 * por exemplo: "eu digo na média, não em um dia específico".
 */
export function interpretSemanticQuery(text: string, contextText?: string | null): SemanticQuery | null {
  const current = normalize(text);
  if (!current) return null;

  const correction = isInterpretationCorrection(text);
  const contextual = correction && contextText
    ? `${normalize(contextText)} ${current}`.trim()
    : current;

  if (isDirectSingleWeekdayLookup(contextual) && !correction) return null;

  const weekday = /\b(qual dia|que dia|em qual dia|dia da semana|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(contextual);
  const spending = /\b(gast\w*|despes\w*|compr\w*|consumo|dinheiro|valor|total)\b/.test(contextual);
  const comparative = /\b(qual dia|que dia|em qual dia|dia da semana|mais gasto|gasto mais|maior gasto|concentrou mais|mais vezes|frequencia|padrao|geralmente|normalmente|costumo|tipicamente|habitual|na media|sem picos|sem outliers)\b/.test(contextual);
  if (!weekday || !spending || !comparative) return null;

  const frequency = /\b(mais vezes|frequencia|quantas compras|numero de compras|quantidade de compras)\b/.test(contextual);
  const ticket = /\b(ticket|por compra|media por compra|valor medio de cada compra)\b/.test(contextual);
  const concentration = /\b(concentrou|concentracao|somando tudo|total por dia|maior volume|participacao do total)\b/.test(contextual);
  const typical = correction || /\b(geralmente|normalmente|costumo|tipicamente|na media|padrao|habitual|sem picos|sem outliers)\b/.test(contextual);

  let interpretation: SemanticQuery["interpretation"] = "typical_behavior";
  let metric_key = "weekday_typical_spend";
  let outlier_policy: SemanticQuery["outlier_policy"] = "exclude_for_typical";

  if (frequency) {
    interpretation = "frequency";
    metric_key = "weekday_purchase_frequency";
    outlier_policy = "keep";
  } else if (ticket) {
    interpretation = "average_ticket";
    metric_key = "weekday_average_ticket";
    outlier_policy = "separate";
  } else if (concentration && !typical) {
    interpretation = "total_concentration";
    metric_key = "weekday_total_concentration";
    outlier_policy = "keep";
  }

  const weeksMatch = contextual.match(/(?:ultim[ao]s?\s+)?(\d{1,2})\s+semanas?/);
  const weeks = Math.min(52, Math.max(4, Number(weeksMatch?.[1] ?? 12)));

  return {
    domain: "spending",
    intent: "weekday_pattern",
    interpretation,
    metric_key,
    output: outputMode(contextual),
    outlier_policy,
    period: { kind: "rolling_weeks", value: weeks },
    correction,
    original_text: text,
  };
}
