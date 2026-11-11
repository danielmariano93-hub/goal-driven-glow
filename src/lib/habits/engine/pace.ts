// Ritmo da semana de um hábito semanal. Só tela (não é espelhado no servidor).
import { diffDays } from "./dates";

export type PaceState = "met" | "on_track" | "due_today" | "behind" | "out_of_reach";

export interface WeekPace {
  state: PaceState;
  /** O que ainda falta para a meta da semana (nunca negativo). */
  needed: number;
  /** Dias que restam na semana, contando hoje. */
  days_left: number;
  /** Quanto já deveria estar feito antes de hoje, no ritmo. */
  expected: number;
}

/**
 * Ritmo de um hábito semanal, a partir da semana corrente (`WeekRow`, que já considera a primeira semana proporcional).
 * - met: a meta da semana está batida.
 * - out_of_reach: faltam mais vezes do que dias restantes. Não fecha mais; vale ajustar a meta.
 * - due_today: ainda fecha, mas sem folga: faltam tantas vezes quanto dias restantes, contando hoje.
 * - behind: abaixo do ritmo, mas ainda com folga.
 * - on_track: no ritmo (ou já treinou hoje e ainda fecha). Dia sem treino, dentro do ritmo, não é atraso.
 * `countable` é falso para meta em quantidade semanal (litros, minutos): aí só vale o ritmo.
 */
export function weekPace(week: { week_start: string; target: number; count: number }, startedOn: string, today: string, countable = true, doneToday = false): WeekPace {
  const windowStart = startedOn > week.week_start ? startedOn : week.week_start;
  const lastDay = addSix(week.week_start);
  const avail = Math.max(1, diffDays(windowStart, lastDay) + 1);
  const elapsedBefore = Math.max(0, diffDays(windowStart, today));
  const daysLeft = Math.max(1, diffDays(today, lastDay) + 1);
  const daysAfterToday = daysLeft - 1;
  const needed = Math.max(0, week.target - week.count);
  const expected = Math.floor((week.target * elapsedBefore) / avail + 1e-9);
  if (week.count + 1e-9 >= week.target) return { state: "met", needed: 0, days_left: daysLeft, expected };
  const n = Math.ceil(needed - 1e-9);
  const room = doneToday ? daysAfterToday : daysLeft;
  const base = { needed, days_left: daysLeft, expected };
  if (countable && n > room) return { state: "out_of_reach", ...base };
  if (week.count + 1e-9 < expected) return { state: "behind", ...base };
  if (countable && !doneToday && n === daysLeft) return { state: "due_today", ...base };
  return { state: "on_track", ...base };
}

const addSix = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
};
