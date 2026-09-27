import { interpretSemanticQuery } from "./semanticQuery.ts";

export type ChartRequest =
  | { mode: "weekday_pattern" }
  | { mode: "monthly_series" }
  | { mode: "category"; days: number }
  | {
      mode: "tool";
      args: {
        kind: "compare" | "forecast" | "goal" | "timeseries" | "average_daily_trend";
        metric?: "expense" | "income";
        days?: number;
      };
    };

function normalize(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedDays(t: string): number {
  const match = t.match(/(?:ultim[ao]s?\s+)?(\d{1,3})\s+dias?/);
  return Math.max(1, Math.min(366, Number(match?.[1] ?? 30)));
}

const MONTH_COUNT_TOKEN = "um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|\\d{1,2}";
const DAILY_GRAIN_RX = /\b(dia a dia|por dia|diari[oa]s?|diariamente)\b/;

function requestsExplicitMonthlyWindow(t: string): boolean {
  if (DAILY_GRAIN_RX.test(t)) return false;
  return new RegExp(`\\bultim[oa]s?\\s+(${MONTH_COUNT_TOKEN})\\s+meses?\\b`).test(t);
}

/**
 * Única fonte de verdade sobre intenção VISUAL explícita (`nino_brain.v2`).
 * "evolução", "tendência", "dia a dia" e "por dia" NÃO são pedidos de gráfico:
 * são análise textual. Só pedidos explícitos geram artefato.
 */
export function hasExplicitChartIntent(text: string): boolean {
  const t = normalize(text);
  if (/\b(grafico|graficos|chart|charts|donut|pizza)\b/.test(t)) return true;
  if (/\b(plote|plotar|plota)\b/.test(t)) return true;
  if (/\b(visualizar|visualizacao|visualiza)\b/.test(t)) return true;
  if (/\bem\s+(linha|linhas|barra|barras|colunas?)\b/.test(t)) return true;
  if (/\b(mostra|mostrar|me mostre|quero)\b.{0,20}\b(grafico|visual)\b/.test(t)) return true;
  return false;
}

/**
 * Visual follow-up that points to already executed evidence. This must not be
 * treated as a fresh generic 30-day chart, otherwise "mostra isso em gráfico"
 * can silently answer a different question from the immediately previous turn.
 */
export function isContextualChartFollowup(text: string): boolean {
  if (!hasExplicitChartIntent(text)) return false;
  const t = normalize(text);
  if (/\b(isso|disso|esse|essa|esses|essas|mesmo|mesma|mesmos|mesmas|dados|resultado|resposta|acima)\b/.test(t)) {
    return true;
  }
  const words = t.split(/\s+/).filter(Boolean);
  return words.length <= 5 && /\b(grafico|visualizacao|visualiza|plotar|plote)\b/.test(t)
    && /\b(mostra|mostrar|mostre|manda|mandar|gere|gera|quero|coloca|poe)\b/.test(t);
}

export function inferChartRequest(text: string): ChartRequest | null {
  const t = normalize(text);
  if (!hasExplicitChartIntent(text)) return null;

  if (interpretSemanticQuery(text)?.intent === "weekday_pattern") {
    return { mode: "weekday_pattern" };
  }
  // Monthly series is not a category breakdown. This check MUST precede the
  // generic category branch or "gráfico de Alimentação mês a mês" becomes a
  // ranking of categories and answers a different question.
  //
  // "gráfico dos últimos N meses" is also monthly by default: a visual request
  // over months means one bucket per calendar month unless the user explicitly
  // asks for daily grain ("dia a dia", "por dia", etc.). This prevents the
  // generic timeseries renderer from turning a 4-month request into a daily line.
  if (/\b(mes a mes|mensalmente ao longo|evolucao mensal|trajetoria mensal)\b/.test(t)
    || requestsExplicitMonthlyWindow(t)) {
    return { mode: "monthly_series" };
  }
  if (/\b(categoria|categorias)\b/.test(t)) {
    return { mode: "category", days: requestedDays(t) };
  }
  if (/\b(previsao|projecao|fechamento do mes|vai fechar)\b/.test(t)) {
    return { mode: "tool", args: { kind: "forecast" } };
  }
  if (/\b(meta|objetivo)\b/.test(t)) {
    return { mode: "tool", args: { kind: "goal" } };
  }
  if (/\b(compare|comparacao|versus| vs |mes passado|mês passado)\b/.test(t)) {
    return { mode: "tool", args: { kind: "compare", metric: /\b(receita|renda|entrada)\b/.test(t) ? "income" : "expense" } };
  }
  if (/\b(media diaria|média diária|ritmo diario|ritmo diário|tendencia da media|tendência da média)\b/.test(t)) {
    return { mode: "tool", args: { kind: "average_daily_trend" } };
  }
  return {
    mode: "tool",
    args: {
      kind: "timeseries",
      metric: /\b(receita|renda|entrada)\b/.test(t) ? "income" : "expense",
      days: requestedDays(t),
    },
  };
}
