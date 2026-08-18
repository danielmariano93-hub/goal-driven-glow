// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Motor Emocional-Financeiro (`emotion_finance.v1`).
// Cruza check-ins emocionais com o comportamento de gasto do próprio usuário,
// SEMPRE contra um baseline pessoal contextual (mesmo dia da semana, dias sem
// aquele registro emocional). O motor calcula; o Nino apenas explica.
//
// REGRA DE LINGUAGEM: o resultado é ASSOCIAÇÃO, nunca causa. Nenhuma frase
// gerada aqui afirma que a emoção causou o gasto.
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  round2,
  type TransactionRow,
} from "./facts.ts";

import {
  confidenceFromSample,
  daysBetweenInclusive,
  madOf,
  makeEnvelope,
  makeEvidence,
  medianOf,
  safePct,
  shiftDays,
  weekdayOf,
  WEEKDAY_LABELS_PT,
  type EngineConfidence,
  type EngineEnvelope,
  type EnginePeriod,
} from "./engineEnvelope.ts";

export const EMOTION_FINANCE_VERSION = "emotion_finance.v1";

/** Amostra mínima de episódios para publicar um padrão simples. */
export const DEFAULT_MIN_SAMPLE = 5;
/** Amostra mínima para um padrão composto (emoção + contexto). */
export const DEFAULT_MIN_COMPOSITE_SAMPLE = 4;
/** Piso de materialidade: abaixo disso a diferença não vira conversa. */
export const DEFAULT_MIN_UPLIFT_PCT = 15;
/** Piso absoluto em reais, para não falar de centavos. */
export const DEFAULT_MIN_DELTA_ABS = 30;

export type EmotionContext = "pre_card_close" | "weekend" | "month_end";

export interface EmotionCheckinRow {
  occurred_at: string;
  mood: number | string;
  emotion_key?: string | null;
  trigger_label?: string | null;
}

export interface EmotionDriver {
  category_id: string | null;
  category_name: string;
  observed: number;
  expected: number;
  delta_abs: number;
  delta_pct: number | null;
}

export interface EmotionEpisode {
  emotion_key: string;
  /** Dia do check-in (YYYY-MM-DD). */
  day: string;
  /** Dias considerados na janela (inclui o dia do registro). */
  window_days: string[];
  observed: number;
  expected: number;
  delta_abs: number;
  purchases: number;
  above_baseline: boolean;
  contexts: EmotionContext[];
}

export interface EmotionPatternFacts {
  emotion_key: string;
  emotion_label: string;
  sample_size: number;
  window_days: number;
  observed_avg: number;
  expected_avg: number;
  delta_abs: number;
  uplift_pct: number | null;
  consistency_hits: number;
  consistency_rate: number;
  purchases_avg: number;
  purchases_baseline_avg: number;
  ticket_avg: number;
  ticket_baseline_avg: number;
  direction: "acima" | "abaixo" | "estavel";
  material: boolean;
}

export interface EmotionPattern {
  facts: EmotionPatternFacts;
  drivers: EmotionDriver[];
  confidence: EngineConfidence;
  context: EmotionContext | null;
  context_label: string | null;
  /** Frase associativa pronta — nunca causal. */
  sentence: string;
}

export interface EmotionFinanceFacts {
  patterns: EmotionPattern[];
  composites: EmotionPattern[];
  checkins_considered: number;
  episodes_considered: number;
  covered_days: number;
  baseline_days: number;
}

export interface EmotionFinanceInput {
  txs: TransactionRow[];
  checkins: EmotionCheckinRow[];
  period: EnginePeriod;
  categoryNames?: Record<string, string>;
  /** Resolução de aliases legados de emoção (catálogo canônico do app). */
  resolveEmotionKey?: (value?: string | null, mood?: number | null) => { key: string; label: string } | null;
  minSample?: number;
  minCompositeSample?: number;
  minUpliftPct?: number;
  minDeltaAbs?: number;
  /** Quantos dias após o registro entram na janela (1 = dia do registro + dia seguinte). */
  windowDays?: number;
  /** Dias de fechamento de fatura conhecidos (1-31), para o contexto pré-fatura. */
  cardCloseDays?: number[];
  /** Janela do contexto "véspera de fatura", em dias. */
  preCardCloseWindow?: number;
}

function dayOf(value: string): string {
  return String(value ?? "").slice(0, 10);
}

/** Série diária de gasto flexível (dias sem gasto contam como zero; estorno abate). */
export function buildDailySpend(
  txs: TransactionRow[],
  period: EnginePeriod,
): { totals: Map<string, number>; counts: Map<string, number>; byCategory: Map<string, Map<string, number>> } {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  const byCategory = new Map<string, Map<string, number>>();

  for (let day = period.from; day <= period.to; day = shiftDays(day, 1)) {
    totals.set(day, 0);
    counts.set(day, 0);
  }

  const attribution = buildRefundAttribution(txs);

  for (const t of txs) {
    const day = dayOf(t.occurred_at);
    if (day < period.from || day > period.to) continue;
    const amount = behavioralMetricAmount(t, "expense");
    if (amount === 0) continue;
    totals.set(day, round2((totals.get(day) ?? 0) + amount));
    if (amount > 0) counts.set(day, (counts.get(day) ?? 0) + 1);
    const catId = effectiveCategoryId(t, attribution) ?? "sem_categoria";
    const bucket = byCategory.get(day) ?? new Map<string, number>();
    bucket.set(catId, round2((bucket.get(catId) ?? 0) + amount));
    byCategory.set(day, bucket);
  }

  for (const [day, value] of totals.entries()) {
    if (value < 0) totals.set(day, 0);
  }


  return { totals, counts, byCategory };
}

/**
 * Baseline pessoal por dia da semana, calculado APENAS com dias de controle
 * (dias fora de qualquer janela do episódio analisado). É isso que neutraliza o
 * confundidor clássico "sexta-feira já é dia de jantar fora".
 */
export function contextualBaseline(
  totals: Map<string, number>,
  counts: Map<string, number>,
  controlDays: string[],
  opts?: { excludeOutliers?: boolean },
): { byWeekday: Map<number, number>; countsByWeekday: Map<number, number>; outliers: string[] } {
  const grouped = new Map<number, Array<{ day: string; value: number; count: number }>>();
  for (const day of controlDays) {
    const wd = weekdayOf(day);
    const list = grouped.get(wd) ?? [];
    list.push({ day, value: totals.get(day) ?? 0, count: counts.get(day) ?? 0 });
    grouped.set(wd, list);
  }

  const byWeekday = new Map<number, number>();
  const countsByWeekday = new Map<number, number>();
  const outliers: string[] = [];

  for (const [wd, list] of grouped.entries()) {
    let values = list;
    if (opts?.excludeOutliers !== false && list.length >= 5) {
      const med = medianOf(list.map((i) => i.value));
      const mad = madOf(list.map((i) => i.value));
      if (mad > 0) {
        const limit = med + 4 * mad;
        const kept = list.filter((i) => i.value <= limit);
        for (const item of list) if (item.value > limit) outliers.push(item.day);
        if (kept.length >= 3) values = kept;
      }
    }
    byWeekday.set(wd, round2(medianOf(values.map((i) => i.value))));
    countsByWeekday.set(wd, medianOf(values.map((i) => i.count)));
  }

  return { byWeekday, countsByWeekday, outliers };
}

function monthPhaseContexts(
  day: string,
  cardCloseDays: number[],
  preWindow: number,
): EmotionContext[] {
  const out: EmotionContext[] = [];
  const wd = weekdayOf(day);
  if (wd === 0 || wd === 6) out.push("weekend");
  const dom = Number(day.slice(8, 10));
  if (dom >= 25) out.push("month_end");
  for (const close of cardCloseDays) {
    const diff = close - dom;
    if (diff >= 0 && diff <= preWindow) {
      out.push("pre_card_close");
      break;
    }
  }
  return out;
}

const CONTEXT_LABELS: Record<EmotionContext, string> = {
  pre_card_close: "na véspera do fechamento da fatura",
  weekend: "em fim de semana",
  month_end: "no fim do mês",
};

/** Constrói os episódios (janela por dias) de cada emoção registrada. */
export function buildEmotionEpisodes(input: EmotionFinanceInput): EmotionEpisode[] {
  const windowDays = Math.max(0, Math.min(3, input.windowDays ?? 1));
  const cardCloseDays = input.cardCloseDays ?? [];
  const preWindow = input.preCardCloseWindow ?? 7;
  const seen = new Set<string>();
  const episodes: EmotionEpisode[] = [];

  const sorted = [...input.checkins].sort((a, b) => dayOf(a.occurred_at).localeCompare(dayOf(b.occurred_at)));
  for (const row of sorted) {
    const day = dayOf(row.occurred_at);
    if (!day || day < input.period.from || day > input.period.to) continue;
    const resolved = input.resolveEmotionKey?.(row.emotion_key ?? row.trigger_label, Number(row.mood))
      ?? (row.emotion_key ? { key: row.emotion_key, label: row.emotion_key } : null);
    if (!resolved) continue;
    const dedup = `${resolved.key}::${day}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const days: string[] = [];
    for (let i = 0; i <= windowDays; i++) {
      const d = shiftDays(day, i);
      if (d <= input.period.to) days.push(d);
    }
    episodes.push({
      emotion_key: resolved.key,
      day,
      window_days: days,
      observed: 0,
      expected: 0,
      delta_abs: 0,
      purchases: 0,
      above_baseline: false,
      contexts: monthPhaseContexts(day, cardCloseDays, preWindow),
    });
  }
  return episodes;
}

function labelFor(input: EmotionFinanceInput, key: string): string {
  return input.resolveEmotionKey?.(key, null)?.label ?? key;
}

function buildPattern(
  input: EmotionFinanceInput,
  emotionKey: string,
  episodes: EmotionEpisode[],
  totals: Map<string, number>,
  counts: Map<string, number>,
  byCategory: Map<string, Map<string, number>>,
  baseline: { byWeekday: Map<number, number>; countsByWeekday: Map<number, number> },
  categoryBaseline: Map<string, Map<number, number>>,
  context: EmotionContext | null,
): EmotionPattern | null {
  if (episodes.length === 0) return null;
  const minSample = context
    ? (input.minCompositeSample ?? DEFAULT_MIN_COMPOSITE_SAMPLE)
    : (input.minSample ?? DEFAULT_MIN_SAMPLE);
  const minUplift = input.minUpliftPct ?? DEFAULT_MIN_UPLIFT_PCT;
  const minDelta = input.minDeltaAbs ?? DEFAULT_MIN_DELTA_ABS;

  let observedTotal = 0;
  let expectedTotal = 0;
  let purchases = 0;
  let purchasesBaseline = 0;
  let hits = 0;
  const observedByCategory = new Map<string, number>();
  const expectedByCategory = new Map<string, number>();

  for (const ep of episodes) {
    let observed = 0;
    let expected = 0;
    let epPurchases = 0;
    let epPurchasesBaseline = 0;
    for (const day of ep.window_days) {
      const wd = weekdayOf(day);
      observed += totals.get(day) ?? 0;
      expected += baseline.byWeekday.get(wd) ?? 0;
      epPurchases += counts.get(day) ?? 0;
      epPurchasesBaseline += baseline.countsByWeekday.get(wd) ?? 0;
      const bucket = byCategory.get(day);
      if (bucket) {
        for (const [cat, value] of bucket.entries()) {
          observedByCategory.set(cat, round2((observedByCategory.get(cat) ?? 0) + value));
        }
      }
      for (const [cat, perWeekday] of categoryBaseline.entries()) {
        expectedByCategory.set(cat, round2((expectedByCategory.get(cat) ?? 0) + (perWeekday.get(wd) ?? 0)));
      }
    }
    ep.observed = round2(observed);
    ep.expected = round2(expected);
    ep.delta_abs = round2(observed - expected);
    ep.purchases = epPurchases;
    ep.above_baseline = observed > expected;
    if (ep.above_baseline) hits++;
    observedTotal += observed;
    expectedTotal += expected;
    purchases += epPurchases;
    purchasesBaseline += epPurchasesBaseline;
  }

  const n = episodes.length;
  const observedAvg = round2(observedTotal / n);
  const expectedAvg = round2(expectedTotal / n);
  const deltaAbs = round2(observedAvg - expectedAvg);
  const upliftPct = safePct(observedAvg, expectedAvg);
  const purchasesAvg = Math.round((purchases / n) * 100) / 100;
  const purchasesBaselineAvg = Math.round((purchasesBaseline / n) * 100) / 100;
  const consistencyRate = Math.round((hits / n) * 100) / 100;

  const drivers: EmotionDriver[] = [...observedByCategory.entries()]
    .map(([cat, observed]) => {
      const expected = expectedByCategory.get(cat) ?? 0;
      return {
        category_id: cat === "sem_categoria" ? null : cat,
        category_name: input.categoryNames?.[cat] ?? (cat === "sem_categoria" ? "Sem categoria" : cat),
        observed: round2(observed / n),
        expected: round2(expected / n),
        delta_abs: round2((observed - expected) / n),
        delta_pct: safePct(observed / n, expected / n),
      };
    })
    .filter((d) => Math.abs(d.delta_abs) >= 1)
    .sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs))
    .slice(0, 3);

  const direction: EmotionPatternFacts["direction"] = upliftPct == null || Math.abs(upliftPct) < minUplift
    ? "estavel"
    : upliftPct > 0 ? "acima" : "abaixo";

  const material = n >= minSample
    && direction !== "estavel"
    && Math.abs(deltaAbs) >= minDelta;

  const confidence: EngineConfidence = n < minSample
    ? "insufficient_data"
    : confidenceFromSample(n, { minSample, goodSample: Math.max(minSample * 3, 12) }) === "high"
        && consistencyRate >= 0.7
      ? "high"
      : consistencyRate >= 0.6 && n >= minSample * 2
        ? "medium"
        : "low";

  const label = labelFor(input, emotionKey);
  const facts: EmotionPatternFacts = {
    emotion_key: emotionKey,
    emotion_label: label,
    sample_size: n,
    window_days: (input.windowDays ?? 1) + 1,
    observed_avg: observedAvg,
    expected_avg: expectedAvg,
    delta_abs: deltaAbs,
    uplift_pct: upliftPct,
    consistency_hits: hits,
    consistency_rate: consistencyRate,
    purchases_avg: purchasesAvg,
    purchases_baseline_avg: purchasesBaselineAvg,
    ticket_avg: purchases > 0 ? round2(observedTotal / purchases) : 0,
    ticket_baseline_avg: purchasesBaseline > 0 ? round2(expectedTotal / purchasesBaseline) : 0,
    direction,
    material,
  };

  return {
    facts,
    drivers,
    confidence,
    context,
    context_label: context ? CONTEXT_LABELS[context] : null,
    sentence: associationSentence(facts, drivers, context),
  };
}

/**
 * Frase associativa — descreve co-ocorrência observada, nunca causa.
 * Proibido por contrato: "porque", "causou", "por estar".
 */
export function associationSentence(
  facts: EmotionPatternFacts,
  drivers: EmotionDriver[],
  context: EmotionContext | null,
): string {
  const label = facts.emotion_label.toLowerCase();
  const when = context ? ` ${CONTEXT_LABELS[context]}` : "";
  const horizon = facts.window_days <= 1 ? "no mesmo dia" : `nas ${facts.window_days * 24}h seguintes`;
  if (facts.sample_size < 3 || facts.direction === "estavel") {
    return `Nos ${facts.sample_size} registros de "${label}"${when}, seu gasto ${horizon} ficou dentro do seu padrão para o mesmo dia da semana.`;
  }
  const pct = Math.abs(Math.round(facts.uplift_pct ?? 0));
  const move = facts.direction === "acima" ? "acima" : "abaixo";
  const driver = drivers[0] && Math.abs(drivers[0].delta_abs) >= 1
    ? ` O que mais aparece nesses episódios é ${drivers[0].category_name.toLowerCase()}.`
    : "";
  return `Nos seus ${facts.sample_size} registros de "${label}"${when}, o gasto ${horizon} ficou em média ${pct}% ${move} do seu padrão para o mesmo dia da semana (${facts.consistency_hits} de ${facts.sample_size} episódios).${driver} É uma associação observada no seu histórico, não uma causa.`;
}

/** Sinal prospectivo do dia: só existe com padrão confiável e material. */
export interface ProspectiveSignal {
  emotion_key: string;
  emotion_label: string;
  uplift_pct: number;
  consistency_hits: number;
  sample_size: number;
  confidence: EngineConfidence;
  headline: string;
  question: string;
}

export function prospectiveSignal(
  patterns: EmotionPattern[],
  todayEmotionKey: string | null,
): ProspectiveSignal | null {
  if (!todayEmotionKey) return null;
  const match = patterns.find((p) =>
    p.facts.emotion_key === todayEmotionKey
    && p.facts.material
    && p.facts.direction === "acima"
    && (p.confidence === "medium" || p.confidence === "high")
  );
  if (!match) return null;
  const f = match.facts;
  return {
    emotion_key: f.emotion_key,
    emotion_label: f.emotion_label,
    uplift_pct: Math.round(f.uplift_pct ?? 0),
    consistency_hits: f.consistency_hits,
    sample_size: f.sample_size,
    confidence: match.confidence,
    headline: `Percebi um sinal: quando você registra "${f.emotion_label.toLowerCase()}", em ${f.consistency_hits} de ${f.sample_size} vezes seus gastos flexíveis ficaram acima do seu padrão nas horas seguintes.`,
    question: "Quer que eu te ajude a segurar os gastos flexíveis até amanhã?",
  };
}

/** Padrões compostos: emoção + contexto financeiro. */
export function compositePatterns(
  input: EmotionFinanceInput,
  episodes: EmotionEpisode[],
  totals: Map<string, number>,
  counts: Map<string, number>,
  byCategory: Map<string, Map<string, number>>,
  baseline: { byWeekday: Map<number, number>; countsByWeekday: Map<number, number> },
  categoryBaseline: Map<string, Map<number, number>>,
): EmotionPattern[] {
  const contexts: EmotionContext[] = ["pre_card_close", "weekend", "month_end"];
  const out: EmotionPattern[] = [];
  const emotions = [...new Set(episodes.map((e) => e.emotion_key))];
  for (const emotion of emotions) {
    for (const context of contexts) {
      const subset = episodes.filter((e) => e.emotion_key === emotion && e.contexts.includes(context));
      const pattern = buildPattern(
        input, emotion, subset.map((e) => ({ ...e })), totals, counts, byCategory,
        baseline, categoryBaseline, context,
      );
      if (pattern && pattern.facts.material) out.push(pattern);
    }
  }
  return out.sort((a, b) => Math.abs(b.facts.delta_abs) - Math.abs(a.facts.delta_abs));
}

/** Baseline por categoria e dia da semana (dias de controle). */
function categoryBaselineOf(
  byCategory: Map<string, Map<string, number>>,
  controlDays: string[],
): Map<string, Map<number, number>> {
  const grouped = new Map<string, Map<number, number[]>>();
  for (const day of controlDays) {
    const wd = weekdayOf(day);
    const bucket = byCategory.get(day);
    const cats = new Set<string>([...(bucket?.keys() ?? [])]);
    for (const cat of cats) {
      const perCat = grouped.get(cat) ?? new Map<number, number[]>();
      const list = perCat.get(wd) ?? [];
      list.push(bucket?.get(cat) ?? 0);
      perCat.set(wd, list);
      grouped.set(cat, perCat);
    }
  }
  const out = new Map<string, Map<number, number>>();
  for (const [cat, perCat] of grouped.entries()) {
    const perWeekday = new Map<number, number>();
    for (const [wd, values] of perCat.entries()) {
      // média sobre TODOS os dias de controle daquele dia da semana
      const controlCount = controlDays.filter((d) => weekdayOf(d) === wd).length || 1;
      const sum = values.reduce((s, v) => s + v, 0);
      perWeekday.set(wd, round2(sum / controlCount));
    }
    out.set(cat, perWeekday);
  }
  return out;
}

export function computeEmotionFinance(
  input: EmotionFinanceInput,
): EngineEnvelope<EmotionFinanceFacts, EmotionPattern, ProspectiveSignal> {
  const { totals, counts, byCategory } = buildDailySpend(input.txs, input.period);
  const episodes = buildEmotionEpisodes(input);
  const allDays: string[] = [];
  for (let day = input.period.from; day <= input.period.to; day = shiftDays(day, 1)) allDays.push(day);

  const emotions = [...new Set(episodes.map((e) => e.emotion_key))];
  const patterns: EmotionPattern[] = [];
  let baselineDaysCount = 0;

  for (const emotion of emotions) {
    const subset = episodes.filter((e) => e.emotion_key === emotion);
    const episodeDays = new Set(subset.flatMap((e) => e.window_days));
    const controlDays = allDays.filter((d) => !episodeDays.has(d));
    baselineDaysCount = Math.max(baselineDaysCount, controlDays.length);
    const baseline = contextualBaseline(totals, counts, controlDays);
    const catBaseline = categoryBaselineOf(byCategory, controlDays);
    const pattern = buildPattern(
      input, emotion, subset, totals, counts, byCategory,
      baseline, catBaseline, null,
    );
    if (pattern) patterns.push(pattern);
  }

  // Compostos usam o baseline global de dias sem NENHUM episódio emocional.
  const allEpisodeDays = new Set(episodes.flatMap((e) => e.window_days));
  const globalControl = allDays.filter((d) => !allEpisodeDays.has(d));
  const globalBaseline = contextualBaseline(totals, counts, globalControl);
  const globalCategoryBaseline = categoryBaselineOf(byCategory, globalControl);
  const composites = compositePatterns(
    input, episodes, totals, counts, byCategory, globalBaseline, globalCategoryBaseline,
  );

  patterns.sort((a, b) => {
    if (a.facts.material !== b.facts.material) return a.facts.material ? -1 : 1;
    return Math.abs(b.facts.delta_abs) - Math.abs(a.facts.delta_abs);
  });

  const sampleSize = episodes.length;
  const best = patterns.find((p) => p.facts.material) ?? patterns[0] ?? null;

  return makeEnvelope<EmotionFinanceFacts, EmotionPattern, ProspectiveSignal>({
    engine: "emotion_finance",
    facts: {
      patterns,
      composites,
      checkins_considered: input.checkins.length,
      episodes_considered: sampleSize,
      covered_days: daysBetweenInclusive(input.period.from, input.period.to),
      baseline_days: baselineDaysCount,
    },
    breakdown: patterns,
    drivers: [],
    evidence: makeEvidence({
      period: input.period,
      sampleSize,
      formulaVersion: EMOTION_FINANCE_VERSION,
      notes: [
        "baseline pessoal por dia da semana, calculado só com dias sem o registro emocional analisado",
        "dias sem gasto entram como zero; dias atípicos (fora de mediana + 4·MAD) saem do baseline",
        "as transações têm data (não hora), então a janela é diária: dia do registro e o dia seguinte",
        "associação observada, sem inferência de causa",
        `${WEEKDAY_LABELS_PT.length} dias da semana controlados`,
      ],
    }),
    confidence: best?.confidence ?? "insufficient_data",
  });
}
