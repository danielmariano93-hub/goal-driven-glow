// GERADO POR scripts/sync-habits-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/habits/engine/<module>.ts (habits_contract.v1)
// habits-core: formas de medir (o que cada hábito acompanha e como o progresso aparece). Puro, sem relógio.
// Cada forma combina: como registra (marca, quantidade, horário, valor, passos), o período e a direção (mais, menos, janela).
import { addDays, diffDays } from "./dates.ts";

export type HabitForm = "check" | "amount" | "duration" | "weekly" | "time" | "ceiling" | "value" | "project" | "quit" | "steps" | "recurring";

export const FORM_LABEL: Record<HabitForm, string> = {
  check: "Feito ou não", amount: "Quantidade no dia", duration: "Duração", weekly: "Vezes por semana", time: "Horário", ceiling: "Teto",
  value: "Valor acompanhado", project: "Projeto com total", quit: "Largar", steps: "Rotina em passos", recurring: "Cuidado recorrente",
};

/** Forma de um hábito: a gravada, ou a que o tipo antigo implica. */
export function formOf(h: { form?: string | null; kind: string }): HabitForm {
  if (h.form && h.form in FORM_LABEL) return h.form as HabitForm;
  return h.kind === "quit" ? "quit" : h.kind === "do_weekly_count" ? "weekly" : h.kind === "do_quantity" ? "amount" : "check";
}

// ---------------------------------------------------------------- projeto (livro, curso, reserva)

export interface ProjectStats {
  percent: number;
  remaining: number;
  /** Ritmo médio por dia (dias fechados, contando os sem avanço). Nulo com menos de 3 dias de avanço. */
  pace: number | null;
  days_left: number | null;
  eta: string | null;
  done: boolean;
  next_mark: number | null;
}

export const PROJECT_MARKS = [25, 50, 75, 100] as const;

/** Mínimo de dias com leitura (de avanço) para prometer uma data de término. */
export const MIN_PROJECT_DAYS = 3;

/**
 * `recent` = avanço por dia, o mais recente (hoje) por último. O ritmo usa só dias FECHADOS (hoje fica de fora, ainda está
 * em andamento) e conta os dias sem avanço, a partir do primeiro dia com avanço; senão o ritmo seria otimista.
 * Com menos de MIN_PROJECT_DAYS dias de avanço não há previsão.
 */
export function projectStats(total: number, current: number, recent: number[], today: string): ProjectStats {
  const t = Math.max(0, total);
  const c = Math.min(Math.max(0, current), t);
  const remaining = Math.max(0, t - c);
  const percent = t > 0 ? Math.round((c / t) * 100) : 0;
  const closed = recent.slice(-15, -1);
  const first = closed.findIndex((n) => n > 0);
  const window = first < 0 ? [] : closed.slice(first);
  const activeDays = window.filter((n) => n > 0).length;
  const pace = activeDays >= MIN_PROJECT_DAYS ? Math.round((window.reduce((a, b) => a + b, 0) / window.length) * 10) / 10 : null;
  const days_left = remaining === 0 ? 0 : pace ? Math.ceil(remaining / pace) : null;
  return {
    percent, remaining, pace, days_left, eta: days_left == null ? null : addDays(today, days_left), done: t > 0 && c >= t,
    next_mark: PROJECT_MARKS.find((m) => m > percent) ?? null,
  };
}

// ---------------------------------------------------------------- ritmo do dia (meta de quantidade "no mínimo")

/** Janela em que se espera que a pessoa esteja acordada: a meta do dia se distribui entre estas horas. */
export const PACE_WAKE = 6;
export const PACE_SLEEP = 22;
/** Até esta fração da meta abaixo do esperado ainda conta como "no ritmo". */
export const PACE_TOLERANCE = 0.1;

export type DayPaceState = "done" | "ahead" | "on_pace" | "behind" | "closed";

export interface DayPace {
  /** Quanto já deveria ter sido feito agora (linha reta entre acordar e dormir). */
  expected: number;
  /** expected - total: positivo = abaixo do ritmo. */
  gap: number;
  remaining: number;
  hours_left: number;
  /** Quanto por hora falta para fechar a meta no que resta do dia (nulo se bateu a meta ou não há mais horas). */
  per_hour_needed: number | null;
  /** Meta dividida igualmente entre as horas acordado: a "sugestão" fixa do dia. */
  per_hour_plan: number;
  state: DayPaceState;
}

/** `nowHour` em horas locais (14,5 = 14h30). Fonte única do ritmo: o app e os lembretes do servidor usam esta função. */
export function dayPace(target: number, total: number, nowHour: number, wake = PACE_WAKE, sleep = PACE_SLEEP): DayPace | null {
  if (!(target > 0) || !(sleep > wake)) return null;
  const t = Math.max(0, total);
  const frac = Math.min(1, Math.max(0, (nowHour - wake) / (sleep - wake)));
  const expected = target * frac;
  const gap = expected - t;
  const remaining = Math.max(0, target - t);
  const hours_left = Math.max(0, sleep - Math.max(nowHour, wake));
  const state: DayPaceState = t >= target ? "done" : nowHour >= sleep ? "closed" : gap <= 0 ? "ahead" : gap <= target * PACE_TOLERANCE ? "on_pace" : "behind";
  return {
    expected, gap, remaining, hours_left, per_hour_needed: remaining > 0 && hours_left > 0 ? remaining / hours_left : null,
    per_hour_plan: target / (sleep - wake), state,
  };
}

// ---------------------------------------------------------------- horário e teto

/** Minutos desde 00:00 de "HH:MM". */
export const minutesOf = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const hhmm = (min: number): string => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

export interface TimeStats {
  n: number;
  avg_min: number | null;
  within: number;
  /** Desvio padrão em minutos: quanto menor, mais regular. */
  spread_min: number | null;
  /** Diferença média para o horário-alvo (negativo = antes do alvo). */
  vs_target_min: number | null;
}

/** `values` em minutos desde 00:00 (já ajustados para a mesma noite: depois da meia-noite use +1440). */
export function timeStats(values: number[], targetMin: number): TimeStats {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return { n: 0, avg_min: null, within: 0, spread_min: null, vs_target_min: null };
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const spread = Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / v.length);
  return {
    n: v.length, avg_min: Math.round(avg), within: v.filter((x) => x <= targetMin).length, spread_min: Math.round(spread),
    vs_target_min: Math.round(avg - targetMin),
  };
}

export interface CeilingStats {
  days: number;
  within: number;
  avg: number | null;
  /** Quanto abaixo do teto, em média, nos dias com registro. */
  headroom: number | null;
}

export function ceilingStats(values: number[], limit: number, daysObserved: number): CeilingStats {
  const v = values.filter((x) => Number.isFinite(x));
  const unlogged = Math.max(0, daysObserved - v.length);
  const within = v.filter((x) => x <= limit).length + unlogged;
  const avg = v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  return { days: daysObserved, within, avg, headroom: avg == null ? null : Math.round((limit - avg) * 10) / 10 };
}

// ---------------------------------------------------------------- valor acompanhado

export interface ValueTrend {
  first: number | null;
  last: number | null;
  /** last − o valor mais próximo de 30 dias antes (nulo sem histórico). */
  delta_30: number | null;
  min: number | null;
  max: number | null;
  toward_goal: boolean | null;
}

export function valueTrend(points: Array<{ date: string; value: number }>, today: string, goal?: number | null): ValueTrend {
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length === 0) return { first: null, last: null, delta_30: null, min: null, max: null, toward_goal: null };
  const last = pts[pts.length - 1];
  const old = pts.filter((p) => diffDays(p.date, today) >= 25 && diffDays(p.date, today) <= 35).pop() ?? (pts.length > 1 ? pts[0] : null);
  const vals = pts.map((p) => p.value);
  const delta = old ? Math.round((last.value - old.value) * 10) / 10 : null;
  return {
    first: pts[0].value, last: last.value, delta_30: delta, min: Math.min(...vals), max: Math.max(...vals),
    toward_goal: goal == null || delta == null ? null : Math.abs(last.value - goal) < Math.abs((old as { value: number }).value - goal),
  };
}

// ---------------------------------------------------------------- cuidado recorrente

export type RecurringState = "ok" | "soon" | "overdue" | "never";
export interface RecurringStatus {
  state: RecurringState;
  last: string | null;
  next: string | null;
  /** Dias até o próximo (negativo = atrasado). */
  days_to: number | null;
}

export function recurringStatus(lastDone: string | null, startedOn: string, intervalDays: number, today: string): RecurringStatus {
  const base = lastDone ?? null;
  const next = addDays(base ?? startedOn, intervalDays);
  const days = diffDays(today, next);
  if (!base && days > 0) return { state: "never", last: null, next, days_to: days };
  return { state: days < 0 ? "overdue" : days <= Math.max(3, Math.round(intervalDays * 0.1)) ? "soon" : "ok", last: base, next, days_to: days };
}

// ---------------------------------------------------------------- conquistas (marcos de progresso real; sem pontos nem ranking)

export interface Achievement {
  key: string;
  title: string;
  hint: string;
  earned: boolean;
}

export interface AchievementInput {
  form: HabitForm;
  best_streak: number;
  /** Duração: minutos acumulados. */
  total_minutes?: number;
  /** Projeto: % do projeto atual e quantos já foram concluídos. */
  project_percent?: number;
  projects_done?: number;
  /** Largar: dias sem do ciclo atual e recorde. */
  days_clean?: number;
  best_clean?: number;
  /** Cuidado recorrente: vezes em dia seguidas. */
  on_time_in_a_row?: number;
  /** Semanas seguidas batendo a meta. */
  weeks_in_a_row?: number;
}

const ladder = (value: number, steps: number[], title: (n: number) => string, hint: (n: number) => string, key: string): Achievement[] =>
  steps.map((n) => ({ key: `${key}:${n}`, title: title(n), hint: hint(n), earned: value >= n }));

export function achievementsFor(i: AchievementInput): Achievement[] {
  switch (i.form) {
    case "quit":
      return ladder(Math.max(i.days_clean ?? 0, i.best_clean ?? 0), [1, 7, 14, 30, 60, 100, 180, 365], (n) => `${n} ${n === 1 ? "dia" : "dias"} sem`, (n) => `Chegar a ${n} dias sem`, "quit");
    case "duration": {
      const h = Math.floor((i.total_minutes ?? 0) / 60);
      return [...ladder(h, [10, 50, 100, 250], (n) => `${n} horas`, (n) => `Somar ${n} horas`, "hours"), ...ladder(i.best_streak, [7, 30], (n) => `${n} dias seguidos`, (n) => `${n} dias seguidos`, "streak")];
    }
    case "project":
      return [
        ...ladder(i.project_percent ?? 0, [25, 50, 75, 100], (n) => `${n}% do projeto`, (n) => `Chegar a ${n}% do projeto atual`, "pct"),
        ...ladder(i.projects_done ?? 0, [1, 3, 5, 10], (n) => `${n} ${n === 1 ? "projeto concluído" : "projetos concluídos"}`, (n) => `Concluir ${n}`, "done"),
      ];
    case "weekly":
      return ladder(i.weeks_in_a_row ?? 0, [2, 4, 8, 12], (n) => `${n} semanas seguidas`, (n) => `Bater a meta por ${n} semanas`, "weeks");
    case "recurring":
      return ladder(i.on_time_in_a_row ?? 0, [1, 3, 5], (n) => `${n} em dia`, (n) => `Fazer ${n} no prazo, em sequência`, "ontime");
    default:
      return ladder(i.best_streak, [7, 21, 66, 100], (n) => `${n} dias seguidos`, (n) => (n === 66 ? "66 dias: o tempo médio de um hábito firmar" : `Chegar a ${n} dias seguidos`), "streak");
  }
}
