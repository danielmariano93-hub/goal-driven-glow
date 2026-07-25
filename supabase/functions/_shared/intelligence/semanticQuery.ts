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

export function interpretSemanticQuery(text: string): SemanticQuery | null {
  const t = normalize(text);
  if (!t) return null;

  const weekday = /\b(qual dia|que dia|dia da semana|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(t);
  const spending = /\b(gast\w*|despes\w*|compr\w*|consumo|dinheiro)\b/.test(t);
  if (!weekday || !spending) return null;

  const correction = /\b(nao foi isso|nao e isso|eu digo|quero dizer|na media|sem considerar|tirando|desconsiderando)\b/.test(t);
  const frequency = /\b(mais vezes|frequencia|quantas compras|numero de compras|quantidade de compras)\b/.test(t);
  const ticket = /\b(ticket|por compra|media por compra|valor medio de cada compra)\b/.test(t);
  const concentration = /\b(concentrou|concentracao|somando tudo|total por dia|maior volume|participacao do total)\b/.test(t);
  const typical = correction || /\b(geralmente|normalmente|costumo|tipicamente|na media|padrao|habitual|sem picos|sem outliers)\b/.test(t);

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

  const weeksMatch = t.match(/(?:ultim[ao]s?\s+)?(\d{1,2})\s+semanas?/);
  const weeks = Math.min(52, Math.max(4, Number(weeksMatch?.[1] ?? 12)));

  return {
    domain: "spending",
    intent: "weekday_pattern",
    interpretation,
    metric_key,
    output: outputMode(t),
    outlier_policy,
    period: { kind: "rolling_weeks", value: weeks },
    correction,
    original_text: text,
  };
}
