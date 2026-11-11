// Ritmo da semana de um hábito semanal: meta batida, em dia ou atrasado. Só tela (não é espelhado no servidor).
import { diffDays } from "./dates";

export type PaceState = "met" | "on_track" | "behind";

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
 * Ritmo de um hábito semanal.
 * - Meta batida: o progresso da semana já chegou na meta.
 * - Atrasado: ficou abaixo do que o ritmo pede, ou já não há folga (faltam tantos quanto os dias que restam, contando hoje).
 * - Em dia: o resto. Dia sem treino, dentro do ritmo, não é atraso.
 * `count` e `target` vêm da semana corrente (`WeekRow`), que já considera a primeira semana proporcional.
 */
export function weekPace(week: { week_start: string; target: number; count: number }, startedOn: string, today: string, countable = true): WeekPace {
  const windowStart = startedOn > week.week_start ? startedOn : week.week_start;
  const lastDay = addSix(week.week_start);
  const avail = Math.max(1, diffDays(windowStart, lastDay) + 1);
  const elapsedBefore = Math.max(0, diffDays(windowStart, today));
  const daysLeft = Math.max(1, diffDays(today, lastDay) + 1);
  const needed = Math.max(0, week.target - week.count);
  const expected = Math.floor((week.target * elapsedBefore) / avail + 1e-9);
  if (week.count + 1e-9 >= week.target) return { state: "met", needed: 0, days_left: daysLeft, expected };
  const noSlack = countable && Math.ceil(needed - 1e-9) >= daysLeft;
  const state: PaceState = week.count + 1e-9 < expected || noSlack ? "behind" : "on_track";
  return { state, needed, days_left: daysLeft, expected };
}

const addSix = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
};
