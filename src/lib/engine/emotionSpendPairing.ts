// Emoção × gasto por JANELA DE HORÁRIO (`emotion_spend_pairing.v2`).
//
// Substitui o pareamento agregado por dia: cada gasto (transação bruta com
// horário) é associado a no máximo UM check-in elegível — o mais próximo dentro
// da janela de 3h antes a 12h depois do check-in. Nenhum gasto é contado em dois
// check-ins. O resultado é ASSOCIAÇÃO observada, nunca causa.
//
// Puro e sem I/O; espelhado para `_shared/finance-core`.
import { emotionalScore, type EmotionalCheckinRow } from "./behaviorDimensions";

export const EMOTION_SPEND_PAIRING_VERSION = "emotion_spend_pairing.v2";

const HOUR_MS = 3_600_000;

export type EmotionSpendWindow = { beforeHours: number; afterHours: number };

/** Janela padrão: gasto até 3h antes ou até 12h depois do check-in. */
export const DEFAULT_EMOTION_SPEND_WINDOW: EmotionSpendWindow = { beforeHours: 3, afterHours: 12 };

/** Mínimos para afirmar associação (mesma régua do pareamento anterior). */
export const EMOTION_SPEND_MIN_PAIRED = 8;
export const EMOTION_SPEND_MIN_PER_GROUP = 3;

/** Gasto com instante conhecido. `at` sem horário confiável não deve chegar aqui. */
export type TimedExpense = { id: string; at: string; amount: number | string };

export type CheckinSpendWindow = {
  checkin: EmotionalCheckinRow;
  spend: number;
  txIds: string[];
};

function ms(value: string): number {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Pareia cada gasto ao check-in mais próximo dentro da janela.
 *
 * Elegibilidade do check-in: horário válido, janela já encerrada em `now`
 * (senão a soma seria parcial) e janela iniciada depois do primeiro gasto
 * observado (antes disso não há como saber se houve gasto).
 * Empate de distância: vence o check-in anterior ao gasto; depois, o id.
 */
export function pairExpensesToCheckins(
  checkins: EmotionalCheckinRow[],
  expenses: TimedExpense[],
  options: { now?: number; window?: EmotionSpendWindow } = {},
): CheckinSpendWindow[] {
  const window = options.window ?? DEFAULT_EMOTION_SPEND_WINDOW;
  const now = options.now ?? Date.now();
  const beforeMs = window.beforeHours * HOUR_MS;
  const afterMs = window.afterHours * HOUR_MS;

  const txs = expenses
    .map((row) => ({ id: String(row.id), t: ms(row.at), amount: Number(row.amount) }))
    .filter((row) => Number.isFinite(row.t) && Number.isFinite(row.amount) && row.amount > 0);
  if (!txs.length) return [];
  const firstTx = Math.min(...txs.map((row) => row.t));

  const seen = new Set<string>();
  const eligible = checkins
    .map((checkin) => ({ checkin, t: ms(checkin.occurred_at) }))
    .filter(({ checkin, t }) => {
      if (!Number.isFinite(t) || seen.has(checkin.id)) return false;
      seen.add(checkin.id);
      return t + afterMs <= now && t - beforeMs >= firstTx;
    })
    .sort((a, b) => a.t - b.t || (a.checkin.id < b.checkin.id ? -1 : 1));

  const windows = new Map<string, CheckinSpendWindow>(
    eligible.map(({ checkin }) => [checkin.id, { checkin, spend: 0, txIds: [] }]),
  );
  const usedTx = new Set<string>();
  for (const tx of txs) {
    if (usedTx.has(tx.id)) continue;
    let best: { id: string; distance: number; after: boolean; t: number } | null = null;
    for (const { checkin, t } of eligible) {
      const delta = tx.t - t; // > 0: gasto depois do check-in
      if (delta < -beforeMs || delta > afterMs) continue;
      const candidate = { id: checkin.id, distance: Math.abs(delta), after: delta >= 0, t };
      if (
        !best
        || candidate.distance < best.distance
        || (candidate.distance === best.distance && candidate.after && !best.after)
      ) best = candidate;
    }
    if (!best) continue;
    usedTx.add(tx.id);
    const target = windows.get(best.id)!;
    target.spend = Math.round((target.spend + tx.amount) * 100) / 100;
    target.txIds.push(tx.id);
  }
  return [...windows.values()];
}

export type EmotionSpendAssociation = {
  version: typeof EMOTION_SPEND_PAIRING_VERSION;
  window: EmotionSpendWindow;
  sufficient: boolean;
  /** Check-ins com janela observável (com ou sem gasto). */
  pairedCheckins: number;
  vulnerableCheckins: number;
  comparisonCheckins: number;
  /** Compatibilidade com o contrato anterior: mesmos valores dos campos *Checkins. */
  pairedDays: number;
  vulnerableDays: number;
  comparisonDays: number;
  vulnerableAverage: number | null;
  comparisonAverage: number | null;
  upliftPct: number | null;
  /** Gastos associados a algum check-in (cada um no máximo uma vez). */
  pairedTransactions: number;
};

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function round(value: number | null, decimals = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

export function isVulnerableCheckin(row: EmotionalCheckinRow): boolean {
  return emotionalScore(row) <= 4 || Number(row.spending_urge_score ?? 0) >= 7;
}

export function isComparisonCheckin(row: EmotionalCheckinRow): boolean {
  return emotionalScore(row) >= 6 && Number(row.spending_urge_score ?? 0) < 7;
}

/** Gasto médio na janela de check-ins sensíveis vs. tranquilos. */
export function computeEmotionSpendAssociation(
  checkins: EmotionalCheckinRow[],
  expenses: TimedExpense[],
  options: { now?: number; window?: EmotionSpendWindow } = {},
): EmotionSpendAssociation {
  const window = options.window ?? DEFAULT_EMOTION_SPEND_WINDOW;
  const paired = pairExpensesToCheckins(checkins, expenses, { ...options, window });
  const vulnerable = paired.filter(({ checkin }) => isVulnerableCheckin(checkin));
  const comparison = paired.filter(({ checkin }) => isComparisonCheckin(checkin));
  const vulnerableAverage = avg(vulnerable.map((row) => row.spend));
  const comparisonAverage = avg(comparison.map((row) => row.spend));
  const sufficient = vulnerable.length >= EMOTION_SPEND_MIN_PER_GROUP
    && comparison.length >= EMOTION_SPEND_MIN_PER_GROUP
    && paired.length >= EMOTION_SPEND_MIN_PAIRED
    && (comparisonAverage ?? 0) > 0;
  const upliftPct = sufficient && vulnerableAverage != null && comparisonAverage != null
    ? round((vulnerableAverage / comparisonAverage - 1) * 100)
    : null;
  return {
    version: EMOTION_SPEND_PAIRING_VERSION,
    window,
    sufficient,
    pairedCheckins: paired.length,
    vulnerableCheckins: vulnerable.length,
    comparisonCheckins: comparison.length,
    pairedDays: paired.length,
    vulnerableDays: vulnerable.length,
    comparisonDays: comparison.length,
    vulnerableAverage: round(vulnerableAverage, 2),
    comparisonAverage: round(comparisonAverage, 2),
    upliftPct,
    pairedTransactions: paired.reduce((sum, row) => sum + row.txIds.length, 0),
  };
}
