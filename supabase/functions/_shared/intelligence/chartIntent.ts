import { interpretSemanticQuery } from "./semanticQuery.ts";

export type ChartRequest =
  | { mode: "weekday_pattern" }
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
    .replace(/\s+/g, " ")
    .trim();
}

function requestedDays(t: string): number {
  const match = t.match(/(?:ultim[ao]s?\s+)?(\d{1,3})\s+dias?/);
  return Math.max(1, Math.min(366, Number(match?.[1] ?? 30)));
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

export function inferChartRequest(text: string): ChartRequest | null {
  const t = normalize(text);
  if (!hasExplicitChartIntent(text)) return null;

  if (interpretSemanticQuery(text)?.intent === "weekday_pattern") {
    return { mode: "weekday_pattern" };
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
