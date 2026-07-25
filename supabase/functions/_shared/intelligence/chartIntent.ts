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

export function inferChartRequest(text: string): ChartRequest | null {
  const t = normalize(text);
  if (!/\b(grafico|chart|visual|linha|barras?|pizza|donut)\b/.test(t)) return null;

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
