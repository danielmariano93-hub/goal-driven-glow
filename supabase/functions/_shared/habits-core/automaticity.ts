// GERADO POR scripts/sync-habits-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/habits/engine/<module>.ts (habits_contract.v1)
// habits-core: automaticidade (autorrelato de 1 a 7) e fase de manutenção. Puro, sem relógio.
// Regra: pergunta a cada 14 dias (volta em 7 se a pessoa disser "agora não"); manutenção = 3 respostas seguidas ≥ 6 com força ≥ 0,66.
import { addDays, diffDays } from "./dates.ts";

export interface AutoCheckin {
  habit_id: string;
  answered_on: string;
  score: number | null;
  skipped: boolean;
}

export const AUTO_EVERY_DAYS = 14;
export const AUTO_SKIP_RETRY_DAYS = 7;
export const AUTO_FIRST_AFTER_DAYS = 14;
export const MAINTENANCE_SCORE = 6;
export const MAINTENANCE_STREAK = 3;

export interface AutomaticitySummary {
  latest: number | null;
  first: number | null;
  /** latest − first (positivo = ficou mais automático). Nulo com menos de 2 respostas. */
  delta: number | null;
  answers: number;
  /** Respostas válidas seguidas, mais recentes, com nota ≥ 6. */
  consecutive_high: number;
  series: Array<{ on: string; score: number }>;
}

const valid = (c: AutoCheckin) => !c.skipped && c.score != null;

export function automaticitySummary(habitId: string, all: AutoCheckin[]): AutomaticitySummary {
  const mine = all.filter((c) => c.habit_id === habitId && valid(c)).sort((a, b) => a.answered_on.localeCompare(b.answered_on));
  const series = mine.map((c) => ({ on: c.answered_on, score: c.score as number }));
  let high = 0;
  for (let i = series.length - 1; i >= 0 && series[i].score >= MAINTENANCE_SCORE; i--) high++;
  return {
    latest: series.length ? series[series.length - 1].score : null,
    first: series.length ? series[0].score : null,
    delta: series.length >= 2 ? series[series.length - 1].score - series[0].score : null,
    answers: series.length,
    consecutive_high: high,
    series,
  };
}

/** Hora de perguntar? Só hábitos de fazer, ativos, com pelo menos 14 dias de vida. */
export function automaticityDue(habit: { id: string; kind: string; started_on: string; status?: string }, all: AutoCheckin[], today: string): boolean {
  if (habit.kind === "quit") return false;
  if (habit.status && habit.status !== "active") return false;
  const mine = all.filter((c) => c.habit_id === habit.id);
  const last = mine.reduce<AutoCheckin | null>((a, c) => (!a || c.answered_on > a.answered_on ? c : a), null);
  if (!last) return diffDays(habit.started_on, today) >= AUTO_FIRST_AFTER_DAYS;
  return today >= addDays(last.answered_on, last.skipped ? AUTO_SKIP_RETRY_DAYS : AUTO_EVERY_DAYS);
}

/** O hábito já é automático o bastante para entrar em manutenção? (precisa também de força firme, checada por quem chama) */
export function isMaintenance(summary: AutomaticitySummary, strength: number | null, firmFrom: number): boolean {
  return summary.consecutive_high >= MAINTENANCE_STREAK && strength != null && strength >= firmFrom;
}

/** Reduz lembretes conforme o hábito fica automático: manutenção = nenhum; nota ≥ 4 = só se ontem faltou. */
export function nudgeLevel(summary: AutomaticitySummary, maintenance: boolean): "normal" | "reduced" | "none" {
  if (maintenance) return "none";
  if (summary.latest != null && summary.latest >= 4) return "reduced";
  return "normal";
}
