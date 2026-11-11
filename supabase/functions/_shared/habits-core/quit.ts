// GERADO POR scripts/sync-habits-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/habits/engine/<module>.ts (habits_contract.v1)
// habits-core: hábitos de largar (dias sem, recorde, recaída sem culpa, marcos, estimativa de dinheiro). Puro, sem relógio.
import { diffDays } from "./dates.ts";

export interface CycleRow {
  id: string;
  habit_id: string;
  started_on: string;
  ended_on: string | null;
  end_reason: "relapse" | "manual_reset" | "archived" | null;
  baseline_daily_cost: number | null;
  baseline_source: "nino_data" | "user_informed" | null;
}
export interface CravingRow { habit_id: string; local_date: string; handled: boolean | null }
export interface SlipRow { habit_id: string; local_date: string; reset: boolean }

export const QUIT_MILESTONES = [1, 3, 7, 14, 30, 60, 100, 180, 365] as const;

export interface QuitStats {
  /** Dias desde o início do ciclo aberto (0 no primeiro dia). */
  days_clean: number;
  best: number;
  /** Soma dos dias de todos os ciclos (o recorde e o total nunca se perdem na recaída). */
  total_days_clean: number;
  relapses: number;
  /** Escorregões que só foram anotados, sem zerar. */
  noted_slips: number;
  cravings_30: number;
  /** 0 a 1; nulo sem vontades respondidas nos últimos 30 dias. */
  craving_handled_rate: number | null;
  last_milestone: number | null;
  next_milestone: number | null;
  started_on: string | null;
}

const span = (c: CycleRow, today: string) => Math.max(0, diffDays(c.started_on, c.ended_on ?? today));

export function quitStats(habitId: string, cycles: CycleRow[], cravings: CravingRow[], slips: SlipRow[], today: string): QuitStats {
  const cs = cycles.filter((c) => c.habit_id === habitId).sort((a, b) => a.started_on.localeCompare(b.started_on));
  const open = cs.find((c) => c.ended_on == null) ?? null;
  const spans = cs.map((c) => span(c, today));
  const days = open ? span(open, today) : 0;
  const since = (d: string) => diffDays(d, today) <= 29 && diffDays(d, today) >= 0;
  const cr = cravings.filter((c) => c.habit_id === habitId && since(c.local_date));
  const answered = cr.filter((c) => c.handled != null);
  const sl = slips.filter((s) => s.habit_id === habitId);
  const reached = QUIT_MILESTONES.filter((m) => m <= days);
  return {
    days_clean: days,
    best: spans.length ? Math.max(...spans) : 0,
    total_days_clean: spans.reduce((a, b) => a + b, 0),
    relapses: sl.filter((s) => s.reset).length,
    noted_slips: sl.filter((s) => !s.reset).length,
    cravings_30: cr.length,
    craving_handled_rate: answered.length ? answered.filter((c) => c.handled).length / answered.length : null,
    last_milestone: reached.length ? reached[reached.length - 1] : null,
    next_milestone: QUIT_MILESTONES.find((m) => m > days) ?? null,
    started_on: open?.started_on ?? null,
  };
}

/** Estimativa do que deixou de ser gasto: média diária anterior × dias − gasto real na categoria durante o ciclo (nunca negativa). */
export function moneyEstimate(baselineDaily: number | null, days: number, spentSince: number | null): number | null {
  if (baselineDaily == null) return null;
  return Math.max(0, Math.round((baselineDaily * days - (spentSince ?? 0)) * 100) / 100);
}

/** Marco atingido hoje (para reconhecer uma única vez). */
export const milestoneToday = (daysClean: number): number | null => (QUIT_MILESTONES as readonly number[]).includes(daysClean) ? daysClean : null;

/** Marcos de sequência de hábitos de fazer. */
export const STREAK_MILESTONES = [7, 14, 30, 60, 100] as const;
export const streakMilestoneToday = (streak: number): number | null => (STREAK_MILESTONES as readonly number[]).includes(streak) ? streak : null;
