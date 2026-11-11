// Métricas por hábito: adesão, sequência, força (estimada) e fase. Funções puras.
// Fórmulas e limiares: docs/NINO_HABITOS_REFINAMENTO_TECNICO.md (seção 6.1). Os valores marcados [calibrar] serão
// revistos na fase F4 com dados reais (a versão da fórmula fica em FORMULA_VERSION).
import { addDays, weekStart } from "./dates";
import { dayRows, isRecurringModel, isWeeklyModel, MINIMUM_WEIGHT, weekRows } from "./outcomes";
import type { DayRow, HabitDef, HabitSummary, LogRow, Outcome, PauseRange, Phase, WeekRow } from "./types";

export const FORMULA_VERSION = "hb_formula.v1";
/** Meia-vida da força: 14 dias (modelo diário) ou 2 semanas (modelo semanal). [calibrar] */
export const ALPHA_DAILY = 1 - Math.pow(2, -1 / 14);
export const ALPHA_WEEKLY = 1 - Math.pow(2, -1 / 2);
/** Força só é mostrada depois de 7 dias (ou 2 semanas) previstos e fechados. */
export const MIN_CLOSED_DAILY = 7;
export const MIN_CLOSED_WEEKLY = 2;
/** Faixas de exibição. [calibrar] */
export const ROOTING_FROM = 0.33;
export const FIRM_FROM = 0.66;

const X: Record<"done" | "minimum" | "missed", number> = { done: 1, minimum: MINIMUM_WEIGHT, missed: 0 };

/** Adesão sobre um conjunto de dias: folga e dias abertos ficam fora. Nulo se não há dia previsto fechado. */
export function adherence(rows: DayRow[]): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.outcome === "done") {
      num += 1;
      den += 1;
    } else if (r.outcome === "minimum") {
      num += MINIMUM_WEIGHT;
      den += 1;
    } else if (r.outcome === "missed") {
      den += 1;
    }
  }
  return den === 0 ? null : num / den;
}

/** Adesão dos últimos `n` dias terminando em `today` (inclusive). */
export function adherenceWindow(rows: DayRow[], today: string, n: number): number | null {
  const from = addDays(today, -(n - 1));
  return adherence(rows.filter((r) => r.date >= from && r.date <= today));
}

/** Adesão semanal: média do progresso das semanas FECHADAS que caem na janela de `n` dias. */
export function weeklyAdherence(weeks: WeekRow[], today: string, n: number): number | null {
  const from = weekStart(addDays(today, -(n - 1)));
  const closed = weeks.filter((w) => w.closed && w.week_start >= from);
  if (closed.length === 0) return null;
  return closed.reduce((s, w) => s + w.progress, 0) / closed.length;
}

/**
 * Sequência no modelo diário. Folga e dia não previsto não quebram nem somam; dia aberto (hoje sem registro) não quebra.
 * Feito e versão mínima somam 1; dia fechado sem registro (ou "hoje não") quebra.
 */
export function streakDaily(rows: DayRow[]): { current: number; best: number } {
  const asc = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  let best = 0;
  let run = 0;
  for (const r of asc) {
    if (r.outcome === "done" || r.outcome === "minimum") {
      run += 1;
      best = Math.max(best, run);
    } else if (r.outcome === "missed") run = 0;
  }
  // A sequência atual é a corrida que termina no último dia relevante (sem contar um "hoje" ainda aberto).
  return { current: run, best };
}

/** Sequência no modelo semanal: semanas seguidas com a meta cumprida. A semana corrente conta se já cumpriu; senão fica de fora. */
export function streakWeekly(weeks: WeekRow[]): { current: number; best: number } {
  let best = 0;
  let run = 0;
  for (const w of weeks) {
    if (w.met) {
      run += 1;
      best = Math.max(best, run);
    } else if (w.closed) run = 0;
    // semana aberta e ainda não cumprida: não quebra nem soma
  }
  return { current: run, best };
}

/** Força ao fim de cada dia (média móvel exponencial). Folga, dia aberto e não previsto não atualizam. */
export function strengthSeriesDaily(rows: DayRow[]): number[] {
  let s = 0;
  const out: number[] = [];
  for (const r of rows) {
    if (r.outcome === "done" || r.outcome === "minimum" || r.outcome === "missed") s = s + ALPHA_DAILY * (X[r.outcome] - s);
    out.push(s);
  }
  return out;
}

/** Força por semana fechada (progresso parcial conta proporcionalmente). */
export function strengthSeriesWeekly(weeks: WeekRow[]): number[] {
  let s = 0;
  const out: number[] = [];
  for (const w of weeks) {
    if (w.closed) s = s + ALPHA_WEEKLY * (w.progress - s);
    out.push(s);
  }
  return out;
}

export function phaseOf(strength: number | null, closedCount: number, weekly: boolean): Phase {
  if (strength == null || closedCount < (weekly ? 3 : 14) || strength < ROOTING_FROM) return "starting";
  return strength < FIRM_FROM ? "rooting" : "firm";
}

const countClosed = (rows: DayRow[]) => rows.filter((r) => r.outcome === "done" || r.outcome === "minimum" || r.outcome === "missed").length;

/** Resumo completo de um hábito para as telas. `today` é o dia local do servidor (já com a virada das 03:00). */
export function summarizeHabit(h: HabitDef, logs: LogRow[], today: string, pauses: PauseRange[] = []): HabitSummary {
  const weekly = isWeeklyModel(h);
  const wkStart = weekStart(today);
  const mine = logs.filter((l) => l.habit_id === h.id);
  const rests = mine.filter((l) => l.status === "rest" && l.local_date >= wkStart && l.local_date <= addDays(wkStart, 6)).length;
  const restsLeft = Math.max(0, h.rest_per_week - rests);
  const todayLog = mine.find((l) => l.local_date === today);

  if (isRecurringModel(h)) {
    return {
      model: "recurring", today: { outcome: todayLog ? "done" : "not_expected", quantity: null }, week: null,
      adherence7: null, adherence30: null, adherence90: null, streak: 0, best_streak: 0, strength: null, phase: "starting",
      closed_count: 0, rests_used_this_week: 0, rests_left_this_week: 0,
    };
  }

  if (weekly) {
    const weeks = weekRows(h, logs, today, pauses);
    const series = strengthSeriesWeekly(weeks);
    const closedWeeks = weeks.filter((w) => w.closed).length;
    const strength = closedWeeks >= MIN_CLOSED_WEEKLY ? series[series.length - 1] ?? null : null;
    const { current, best } = streakWeekly(weeks);
    const rows = dayRows(h, logs, addDays(today, -89), today, today, pauses);
    const outcome: Outcome = h.started_on > today ? "not_expected" : todayLog ? rows[rows.length - 1].outcome : "unlogged";
    return {
      model: "weekly",
      today: { outcome, quantity: todayLog?.quantity ?? null },
      week: weeks.length ? weeks[weeks.length - 1] : null,
      adherence7: weeklyAdherence(weeks, today, 7),
      adherence30: weeklyAdherence(weeks, today, 30),
      adherence90: weeklyAdherence(weeks, today, 90),
      streak: current,
      best_streak: best,
      strength,
      phase: phaseOf(strength, closedWeeks, true),
      closed_count: closedWeeks,
      rests_used_this_week: rests,
      rests_left_this_week: restsLeft,
    };
  }

  const from = h.started_on > addDays(today, -399) ? h.started_on : addDays(today, -399);
  const rows = h.started_on > today ? [] : dayRows(h, logs, from, today, today, pauses);
  const closed = countClosed(rows);
  const series = strengthSeriesDaily(rows);
  const strength = closed >= MIN_CLOSED_DAILY ? series[series.length - 1] ?? null : null;
  const { current, best } = streakDaily(rows);
  const todayRow = rows.length ? rows[rows.length - 1] : undefined;
  return {
    model: "daily",
    today: { outcome: todayRow?.date === today ? todayRow.outcome : "not_expected", quantity: todayLog?.quantity ?? null },
    week: null,
    adherence7: adherenceWindow(rows, today, 7),
    adherence30: adherenceWindow(rows, today, 30),
    adherence90: adherenceWindow(rows, today, 90),
    streak: current,
    best_streak: best,
    strength,
    phase: phaseOf(strength, closed, false),
    closed_count: closed,
    rests_used_this_week: rests,
    rests_left_this_week: restsLeft,
  };
}

/** Texto curto da fase, para as telas. */
export const PHASE_LABEL: Record<Phase, string> = {
  starting: "Começando",
  rooting: "Criando raiz",
  firm: "Firme",
  maintenance: "Manutenção",
};
