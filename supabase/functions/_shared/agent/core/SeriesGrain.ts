// SeriesGrain (`nino_series_grain.v1`)
//
// Única fonte do que é o GRÃO de uma série pedida em português. O resto do
// sistema (contrato, IR, motor, gráfico) só recebe o grão já decidido: o gráfico
// é um template por grão preenchido com os dados e o período pedidos.
export const SERIES_GRAINS = ["day", "week", "month", "quarter"] as const;
export type SeriesGrain = typeof SERIES_GRAINS[number];

/** Grãos executados pelo motor de série com recorte (o mês tem motor próprio). */
export const SCOPED_SERIES_GRAINS = ["day", "week", "quarter"] as const;
export type ScopedSeriesGrain = typeof SCOPED_SERIES_GRAINS[number];

/** Quantos pontos cabem num gráfico legível, por grão. */
export const MAX_SERIES_POINTS: Record<SeriesGrain, number> = {
  day: 93,
  week: 53,
  month: 24,
  quarter: 12,
};

function normalize(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Palavras que por si só pedem uma série ("gastos dia a dia", "semanal").
const STRONG_PATTERNS: Array<[SeriesGrain, RegExp]> = [
  ["day", /\b(dia a dia|diari[oa]s?|diariamente|cada dia|todos os dias)\b/],
  ["week", /\b(semana a semana|semanal|semanais|semanalmente|cada semana)\b/],
  ["quarter", /\b(trimestre a trimestre|trimestral|trimestrais|trimestralmente|cada trimestre)\b/],
  ["month", /\b(mes a mes|mensalmente|cada mes)\b/],
];
// "por dia/semana/mês" só é série junto de um pedido visual ("gráfico por dia");
// sozinho ("quanto gastei por dia?") é outra pergunta.
const WEAK_PATTERNS: Array<[SeriesGrain, RegExp]> = [
  ["day", /\bpor dia\b/],
  ["week", /\bpor semana\b/],
  ["quarter", /\bpor trimestre\b/],
  ["month", /\b(por mes|mensal|mensais)\b/],
];
const VISUAL_WORDS = /\b(grafico|graficos|chart|plot[ae]r?|visualiza\w*|barras?|linhas?)\b/;

// "média diária", "ritmo semanal", "quanto gasto por mês em média" são uma
// estatística, não uma série.
const STATISTIC_WORDS = /\b(media|medio|ritmo|tipico|normalmente|costumo|aproximadamente)\b/;

/** Grão de série pedido explicitamente no texto, ou null. */
export function requestedSeriesGrain(text: string): SeriesGrain | null {
  const t = normalize(text);
  if (STATISTIC_WORDS.test(t)) return null;
  for (const [grain, pattern] of STRONG_PATTERNS) {
    if (pattern.test(t)) return grain;
  }
  if (!VISUAL_WORDS.test(t)) return null;
  for (const [grain, pattern] of WEAK_PATTERNS) {
    if (pattern.test(t)) return grain;
  }
  return null;
}

export function isScopedSeriesGrain(value: unknown): value is ScopedSeriesGrain {
  return (SCOPED_SERIES_GRAINS as readonly string[]).includes(String(value));
}
