// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Mapa semanal de concentração de gastos por categoria (`category_weekday_heatmap.v1`).
//
// LENTE COMPORTAMENTAL: responde "em que DIA DA SEMANA o gasto aconteceu".
// Nunca competência de fatura (`reportingCompetenceDate`), nunca vencimento.
// Uma compra de cartão feita no sábado é um gasto de SÁBADO, mesmo que
// financeiramente pertença à fatura do mês seguinte — isso é proposital.
//
// Todo o recorte de consumo reusa o contrato canônico de `facts.ts`
// (`isRealMonthlyMovement`, `behavioralMetricAmount`, `buildRefundAttribution`,
// `effectiveCategoryId`), então transferência, aplicação/resgate, pagamento de
// fatura, planned/cancelled/superseded ficam fora e estorno abate a categoria
// original. Nenhuma regra é reescrita aqui.

import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  round2,
  type CategoryRow,
  type TransactionRow,
} from "./facts.ts";

export const CATEGORY_WEEKDAY_HEATMAP_VERSION = "category_weekday_heatmap.v1";

/** Confiança mínima para aceitar `behavioral_day` como dia do comportamento. */
export const MIN_BEHAVIOR_DATE_CONFIDENCE = 0.65;
/** Piso aplicado a datas vindas do extrato bancário (mesma regra do runtime). */
export const BANK_POSTING_BEHAVIOR_CONFIDENCE = 0.7;

/** Linha de entrada: contrato canônico + dimensão comportamental opcional. */
export type HeatmapTransactionRow = TransactionRow & {
  behavioral_day?: string | null;
  behavior_date_source?: string | null;
  behavior_date_confidence?: number | string | null;
};

export type WeekdayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** Ordem obrigatória de exibição: segunda → domingo. */
export const WEEKDAY_ORDER: WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const WEEKDAY_LABELS: Record<WeekdayKey, { full: string; short: string }> = {
  monday: { full: "segunda-feira", short: "S" },
  tuesday: { full: "terça-feira", short: "T" },
  wednesday: { full: "quarta-feira", short: "Q" },
  thursday: { full: "quinta-feira", short: "Q" },
  friday: { full: "sexta-feira", short: "S" },
  saturday: { full: "sábado", short: "S" },
  sunday: { full: "domingo", short: "D" },
};

/** `Date.getUTCDay()` (0=domingo) → chave na ordem segunda-primeiro. */
const JS_DAY_TO_KEY: WeekdayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export interface HeatmapCell {
  weekday: WeekdayKey;
  /** Total líquido da categoria naquele dia da semana na janela. */
  total: number;
  /** total / ocorrências reais daquele dia da semana na janela. */
  average: number;
  /** average do dia / soma dos sete averages da categoria (0..1). */
  share: number;
  /** average / maior average da PRÓPRIA categoria (0..1). */
  intensity: number;
  /** Faixa visual 0..5 (0 = neutro). */
  level: 0 | 1 | 2 | 3 | 4 | 5;
}

export interface HeatmapCategory {
  categoryId: string;
  categoryName: string;
  total: number;
  cells: HeatmapCell[];
}

export interface HeatmapInsight {
  categoryId: string;
  categoryName: string;
  weekday: WeekdayKey;
  type: "weekend_concentration" | "weekday_peak";
  text: string;
  confidence: "high" | "medium";
}

export interface CategoryWeekdayHeatmap {
  formulaVersion: string;
  period: { start: string; end: string; days: number };
  weekdayOccurrences: Record<WeekdayKey, number>;
  categories: HeatmapCategory[];
  insight: HeatmapInsight | null;
  dataQuality: {
    observedDays: number;
    sufficientHistory: boolean;
    sampleSize: number;
    bankPostingShare: number;
  };
}

export const UNCATEGORIZED_ID = "__none__";

/** Materialidade mínima para afirmar padrão (mesma escala usada nos insights). */
const MIN_INSIGHT_TOTAL = 150;
/** Pico precisa ser 35% acima da média dos outros seis dias. */
const INSIGHT_PEAK_RATIO = 1.35;

export function weekdayKeyOf(dateStr: string): WeekdayKey {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const day = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return JS_DAY_TO_KEY[day];
}

export interface ResolvedBehaviorDay {
  day: string;
  source: string;
  confidence: number;
  fromBankPosting: boolean;
}

/**
 * Dia comportamental de uma linha: `behavioral_day` quando confiável, senão
 * `occurred_at`. Datas de extrato entram com piso de confiança e viajam
 * sinalizadas para que a leitura possa dizer a ressalva.
 */
export function resolveHeatmapBehaviorDay(row: HeatmapTransactionRow): ResolvedBehaviorDay {
  const source = String(row.behavior_date_source ?? "user_entered");
  const fromBankPosting = source === "bank_posting_date";
  const raw = Number(row.behavior_date_confidence);
  const declared = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
  const confidence = fromBankPosting
    ? Math.max(declared, BANK_POSTING_BEHAVIOR_CONFIDENCE)
    : declared;
  const candidate = String(row.behavioral_day ?? "").slice(0, 10);
  const fallback = String(row.occurred_at ?? "").slice(0, 10);
  const day = candidate && confidence >= MIN_BEHAVIOR_DATE_CONFIDENCE ? candidate : fallback;
  return { day, source, confidence, fromBankPosting };
}

function daysBetweenInclusive(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** Quantas vezes cada dia da semana ocorre na janela — denominador real. */
export function countWeekdayOccurrences(
  start: string,
  end: string,
): Record<WeekdayKey, number> {
  const out: Record<WeekdayKey, number> = {
    monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0,
  };
  const total = daysBetweenInclusive(start, end);
  const base = Date.parse(`${start}T12:00:00Z`);
  for (let i = 0; i < total; i += 1) {
    const iso = new Date(base + i * 86400000).toISOString().slice(0, 10);
    out[weekdayKeyOf(iso)] += 1;
  }
  return out;
}

function levelOf(intensity: number): HeatmapCell["level"] {
  if (intensity <= 0) return 0;
  if (intensity <= 0.2) return 1;
  if (intensity <= 0.4) return 2;
  if (intensity <= 0.6) return 3;
  if (intensity <= 0.8) return 4;
  return 5;
}

export interface HeatmapInput {
  transactions: HeatmapTransactionRow[];
  categories: CategoryRow[];
  range: { start: string; end: string };
  /** Mantido no contrato para evolução; as datas já chegam locais (YYYY-MM-DD). */
  timezone?: string;
  /** Quantas categorias exibir (padrão 5). */
  topCategories?: number;
  /** Mínimo de dias com histórico útil para afirmar padrão (padrão 28). */
  minHistoryDays?: number;
}

export function computeCategoryWeekdayHeatmap(input: HeatmapInput): CategoryWeekdayHeatmap {
  const { start, end } = input.range;
  const topN = Math.max(1, input.topCategories ?? 5);
  const minHistoryDays = input.minHistoryDays ?? 28;
  const weekdayOccurrences = countWeekdayOccurrences(start, end);

  const attribution = buildRefundAttribution(input.transactions);
  const totalsByCategory = new Map<string, number>();
  const cellTotals = new Map<string, Map<WeekdayKey, number>>();
  const observed = new Set<string>();
  let sampleSize = 0;
  let baseTotal = 0;
  let bankTotal = 0;

  for (const t of input.transactions) {
    const signed = behavioralMetricAmount(t, "expense");
    if (signed === 0) continue;
    const resolved = resolveHeatmapBehaviorDay(t);
    if (!resolved.day || resolved.day < start || resolved.day > end) continue;

    const key = effectiveCategoryId(t, attribution) ?? UNCATEGORIZED_ID;
    const weekday = weekdayKeyOf(resolved.day);
    totalsByCategory.set(key, (totalsByCategory.get(key) ?? 0) + signed);
    const row = cellTotals.get(key) ?? new Map<WeekdayKey, number>();
    row.set(weekday, (row.get(weekday) ?? 0) + signed);
    cellTotals.set(key, row);

    observed.add(resolved.day);
    sampleSize += 1;
    if (signed > 0) {
      baseTotal += signed;
      if (resolved.fromBankPosting) bankTotal += signed;
    }
  }

  const nameOf = (id: string) =>
    id === UNCATEGORIZED_ID
      ? "Sem categoria"
      : input.categories.find((c) => c.id === id)?.name ?? "Categoria removida";

  const ranked = [...totalsByCategory.entries()]
    .map(([id, total]) => ({ id, total: round2(total) }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, topN);

  const categories: HeatmapCategory[] = ranked.map(({ id, total }) => {
    const row = cellTotals.get(id) ?? new Map<WeekdayKey, number>();
    const averages = WEEKDAY_ORDER.map((weekday) => {
      const occurrences = weekdayOccurrences[weekday];
      const cellTotal = Math.max(0, round2(row.get(weekday) ?? 0));
      const average = occurrences > 0 ? cellTotal / occurrences : 0;
      return { weekday, total: cellTotal, average };
    });
    const maxAverage = Math.max(...averages.map((a) => a.average), 0);
    const sumAverages = averages.reduce((s, a) => s + a.average, 0);
    const cells: HeatmapCell[] = averages.map((a) => {
      const intensity = maxAverage > 0 ? a.average / maxAverage : 0;
      return {
        weekday: a.weekday,
        total: round2(a.total),
        average: round2(a.average),
        share: sumAverages > 0 ? a.average / sumAverages : 0,
        intensity,
        level: levelOf(intensity),
      };
    });
    return { categoryId: id, categoryName: nameOf(id), total, cells };
  });

  const observedDays = observed.size;
  const sufficientHistory = observedDays >= minHistoryDays;

  return {
    formulaVersion: CATEGORY_WEEKDAY_HEATMAP_VERSION,
    period: { start, end, days: daysBetweenInclusive(start, end) },
    weekdayOccurrences,
    categories,
    insight: sufficientHistory ? buildHeatmapInsight(categories) : null,
    dataQuality: {
      observedDays,
      sufficientHistory,
      sampleSize,
      bankPostingShare: baseTotal > 0 ? bankTotal / baseTotal : 0,
    },
  };
}

/** Frase determinística — só quando o padrão é forte e materialmente relevante. */
export function buildHeatmapInsight(categories: HeatmapCategory[]): HeatmapInsight | null {
  let best: HeatmapInsight | null = null;
  let bestTotal = 0;

  for (const category of categories) {
    if (category.total < MIN_INSIGHT_TOTAL) continue;
    const peak = category.cells.reduce((a, b) => (b.average > a.average ? b : a), category.cells[0]);
    if (!peak || peak.average <= 0) continue;
    const others = category.cells.filter((c) => c.weekday !== peak.weekday);
    const othersAverage = others.reduce((s, c) => s + c.average, 0) / Math.max(1, others.length);
    if (othersAverage > 0 && peak.average < INSIGHT_PEAK_RATIO * othersAverage) continue;
    if (category.total <= bestTotal) continue;

    const weekendAverage = category.cells
      .filter((c) => c.weekday === "saturday" || c.weekday === "sunday")
      .reduce((s, c) => s + c.average, 0);
    const totalAverage = category.cells.reduce((s, c) => s + c.average, 0);
    const weekendHeavy = totalAverage > 0 && weekendAverage / totalAverage >= 0.5;

    best = weekendHeavy
      ? {
          categoryId: category.categoryId,
          categoryName: category.categoryName,
          weekday: peak.weekday,
          type: "weekend_concentration",
          text: `Seu ${category.categoryName} se concentra principalmente no fim de semana.`,
          confidence: "high",
        }
      : {
          categoryId: category.categoryId,
          categoryName: category.categoryName,
          weekday: peak.weekday,
          type: "weekday_peak",
          text: `${category.categoryName} pesa mais na ${WEEKDAY_LABELS[peak.weekday].full}.`,
          confidence: "medium",
        };
    bestTotal = category.total;
  }

  return best;
}
