// habits-core: tipos do motor de cálculo de hábitos (puro, sem dependência de React, Supabase ou relógio).
// Documento: docs/NINO_HABITOS_REFINAMENTO_TECNICO.md (seção 6). Datas sempre "AAAA-MM-DD" no dia local da pessoa.

export type HabitKind = "do_daily" | "do_weekly_count" | "do_quantity" | "quit";
export type LogStatus = "done" | "minimum" | "rest" | "skipped" | "quantity";
export type Outcome = "done" | "minimum" | "rest" | "missed" | "unlogged" | "not_expected";
export type Phase = "starting" | "rooting" | "firm" | "maintenance";

export interface HabitDef {
  id: string;
  kind: HabitKind;
  /** Primeiro dia (local) em que o hábito vale. */
  started_on: string;
  /** 0 = domingo … 6 = sábado. Nulo = todos os dias. */
  days_of_week: number[] | null;
  weekly_target: number | null;
  quantity_target: number | null;
  quantity_period: "day" | "week" | null;
  rest_per_week: number;
}

export interface LogRow {
  habit_id: string;
  local_date: string;
  status: LogStatus;
  quantity: number | null;
}

/** Período em que o hábito esteve pausado (os dias dele não contam). `to` nulo = ainda pausado. Ambos inclusivos. */
export interface PauseRange {
  from: string;
  to: string | null;
}

export interface DayRow {
  date: string;
  outcome: Outcome;
}

export interface WeekRow {
  /** Segunda-feira da semana ISO. */
  week_start: string;
  /** Meta efetiva da semana (proporcional se o hábito começou no meio dela). */
  target: number;
  /** Progresso bruto: feitos + 0,6 · versão mínima (ou soma de quantidade). */
  count: number;
  /** 0 a 1. */
  progress: number;
  closed: boolean;
  met: boolean;
}

export type CadenceModel = "daily" | "weekly";

export interface HabitSummary {
  model: CadenceModel;
  /** Estado de hoje (modelo diário) ou da semana corrente (modelo semanal). */
  today: { outcome: Outcome; quantity: number | null };
  week: WeekRow | null;
  adherence7: number | null;
  adherence30: number | null;
  adherence90: number | null;
  /** Dias (modelo diário) ou semanas (modelo semanal) seguidos. */
  streak: number;
  best_streak: number;
  /** 0 a 1; nulo até haver dados suficientes. É uma estimativa, não uma nota. */
  strength: number | null;
  phase: Phase;
  /** Dias (ou semanas) previstos e já fechados. */
  closed_count: number;
  rests_used_this_week: number;
  rests_left_this_week: number;
}
