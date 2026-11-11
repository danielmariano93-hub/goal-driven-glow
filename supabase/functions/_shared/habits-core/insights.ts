// GERADO POR scripts/sync-habits-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/habits/engine/<module>.ts (habits_contract.v1)
// habits-core: revisão semanal, marcações medidas pelo Nino e a régua estatística dos insights de dinheiro. Puro, sem relógio.
// Regra de ouro: nenhum insight sai sem amostra mínima, e todo insight vem com "associação, não causa" na tela.
import { addDays, weekStart } from "./dates.ts";
import { adherence } from "./metrics.ts";
import { dayRows } from "./outcomes.ts";
import type { HabitDef, LogRow, PauseRange } from "./types.ts";

/** Marcação medida pelo Nino (regra sobre as transações) vira marcação comum, mas só onde a pessoa não marcou nada. */
export function mergeAutoLogs<T extends LogRow>(manual: T[], auto: Array<LogRow & { source?: string }>): LogRow[] {
  const taken = new Set(manual.map((l) => `${l.habit_id}|${l.local_date}`));
  const extra = auto.filter((l) => !taken.has(`${l.habit_id}|${l.local_date}`)).map((l) => ({ habit_id: l.habit_id, local_date: l.local_date, status: l.status, quantity: l.quantity }));
  return [...manual, ...extra];
}

export interface WeeklyReviewRow {
  habit_id: string;
  done: number;
  expected: number;
  prev_done: number;
  prev_expected: number;
}

const doneCount = (rows: ReturnType<typeof dayRows>) => rows.filter((r) => r.outcome === "done" || r.outcome === "minimum").length;
const expectedCount = (rows: ReturnType<typeof dayRows>) => rows.filter((r) => r.outcome === "done" || r.outcome === "minimum" || r.outcome === "missed" || r.outcome === "unlogged").length;

/** Semana corrente (segunda até hoje) contra a semana anterior inteira, só para hábitos de modelo diário. */
export function weeklyReview(defs: Array<{ def: HabitDef; pauses?: PauseRange[] }>, logs: LogRow[], today: string): WeeklyReviewRow[] {
  const ws = weekStart(today);
  const pws = addDays(ws, -7);
  return defs
    .filter(({ def }) => def.kind === "do_daily")
    .map(({ def, pauses }) => {
      const cur = dayRows(def, logs, ws, today, today, pauses ?? []);
      const prev = dayRows(def, logs, pws, addDays(ws, -1), today, pauses ?? []);
      return { habit_id: def.id, done: doneCount(cur), expected: expectedCount(cur), prev_done: doneCount(prev), prev_expected: expectedCount(prev) };
    })
    .filter((r) => r.expected > 0 || r.prev_expected > 0);
}

/** Texto fixo da revisão: só números que a pessoa marcou, sem pontos e sem culpa. */
export function reviewText(rows: WeeklyReviewRow[], titleOf: (id: string) => string): string {
  if (rows.length === 0) return "";
  const lines = rows.map((r) => {
    const trend = r.prev_expected > 0 ? (r.done > r.prev_done ? " Melhor que a semana passada." : r.done === r.prev_done ? " Igual à semana passada." : "") : "";
    return `${titleOf(r.habit_id)}: ${r.done} de ${r.expected} dias.${trend}`;
  });
  return `Sua semana nos hábitos:\n${lines.join("\n")}\nSemana que vem é um novo começo.`;
}

// ---------------------------------------------------------------- insights de dinheiro

export const INSIGHT_MIN_WEEKS = 8;
export const INSIGHT_MIN_GROUP = 3;
export const INSIGHT_HIGH_ADHERENCE = 0.7;
export const INSIGHT_MIN_REL_DIFF = 0.15;
export const INSIGHT_MIN_ABS_DIFF = 20;

export interface WeekPoint {
  week_start: string;
  /** Adesão do hábito na semana (nulo se não houve dia previsto fechado). */
  adherence: number | null;
  /** Gasto real da categoria na semana, em reais. */
  spent: number;
}

export type MoneyInsight =
  | { status: "insufficient"; weeks: number; needed: number; reason: string }
  | { status: "no_difference"; weeks: number; high_n: number; low_n: number; mean_high: number; mean_low: number }
  | { status: "ok"; weeks: number; high_n: number; low_n: number; mean_high: number; mean_low: number; /** gasto médio a menos nas semanas de adesão alta */ diff: number };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Compara o gasto médio da categoria nas semanas em que o hábito foi firme (adesão ≥ 70%) com as demais.
 * Só fala com 8+ semanas, 3+ semanas em cada grupo, diferença de ao menos 15% e R$ 20. É associação, não causa.
 */
export function moneyInsight(points: WeekPoint[]): MoneyInsight {
  const valid = points.filter((p) => p.adherence != null);
  if (valid.length < INSIGHT_MIN_WEEKS) {
    return { status: "insufficient", weeks: valid.length, needed: INSIGHT_MIN_WEEKS - valid.length, reason: "weeks" };
  }
  const high = valid.filter((p) => (p.adherence as number) >= INSIGHT_HIGH_ADHERENCE).map((p) => p.spent);
  const low = valid.filter((p) => (p.adherence as number) < INSIGHT_HIGH_ADHERENCE).map((p) => p.spent);
  if (high.length < INSIGHT_MIN_GROUP || low.length < INSIGHT_MIN_GROUP) {
    return { status: "insufficient", weeks: valid.length, needed: 0, reason: "groups" };
  }
  const mh = mean(high);
  const ml = mean(low);
  const overall = mean(valid.map((p) => p.spent));
  const diff = ml - mh;
  const out = { weeks: valid.length, high_n: high.length, low_n: low.length, mean_high: Math.round(mh * 100) / 100, mean_low: Math.round(ml * 100) / 100 };
  if (diff >= INSIGHT_MIN_ABS_DIFF && overall > 0 && diff / overall >= INSIGHT_MIN_REL_DIFF) return { status: "ok", ...out, diff: Math.round(diff * 100) / 100 };
  return { status: "no_difference", ...out };
}

/** Pontos semanais (adesão do hábito × gasto da categoria) a partir dos registros. `spend` vem de `hb_weekly_category_spend`. */
export function weekPoints(def: HabitDef, logs: LogRow[], today: string, spend: Array<{ week_start: string; spent: number }>, pauses: PauseRange[] = []): WeekPoint[] {
  return spend
    .filter((w) => w.week_start >= def.started_on || addDays(w.week_start, 6) >= def.started_on)
    .map((w) => ({ week_start: w.week_start, spent: w.spent, adherence: adherence(dayRows(def, logs, w.week_start, addDays(w.week_start, 6), today, pauses)) }));
}
