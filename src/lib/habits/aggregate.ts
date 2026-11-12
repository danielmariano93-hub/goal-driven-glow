// Agregação entre hábitos (tela Hoje e Progresso). Funções puras sobre o motor; só os hábitos de modelo DIÁRIO entram
// no mostrador e nas adesões agregadas (hábitos de meta semanal têm a leitura própria por semana).
import { addDays, dayRows, dow, isWeeklyModel, MINIMUM_WEIGHT, weekStart, type DayRow, type HabitDef, type LogRow, type PauseRange } from "@/lib/habits/engine";

export interface AggInput {
  def: HabitDef;
  pauses?: PauseRange[];
}

export type DayState = "full" | "partial" | "none" | "rest" | "empty";

export interface DayAggregate {
  date: string;
  state: DayState;
  /** Dia de hoje (ainda aberto). */
  is_today: boolean;
}

export type RowsByHabit = Map<string, DayRow[]>;

export function rowsFor(inputs: AggInput[], logs: LogRow[], from: string, to: string, today: string): RowsByHabit {
  const map: RowsByHabit = new Map();
  for (const { def, pauses } of inputs) {
    if (isWeeklyModel(def) || def.kind === "quit") continue;
    map.set(def.id, dayRows(def, logs, from, to, today, pauses ?? []));
  }
  return map;
}

function tally(rows: DayRow[]) {
  let num = 0;
  let den = 0;
  let rest = 0;
  for (const r of rows) {
    if (r.outcome === "done") { num += 1; den += 1; }
    else if (r.outcome === "minimum") { num += MINIMUM_WEIGHT; den += 1; }
    else if (r.outcome === "missed") den += 1;
    else if (r.outcome === "rest") rest += 1;
  }
  return { num, den, rest };
}

/** Como foi um dia, somando todos os hábitos previstos: completo, parcial, em branco, só folga ou sem hábito previsto. */
export function dayAggregates(rowsByHabit: RowsByHabit, from: string, to: string, today: string): DayAggregate[] {
  const out: DayAggregate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let num = 0;
    let den = 0;
    let rest = 0;
    for (const rows of rowsByHabit.values()) {
      const r = rows.find((x) => x.date === d);
      if (!r) continue;
      const t = tally([r]);
      num += t.num; den += t.den; rest += t.rest;
      // hoje ainda aberto: o que falta é pendência, não falha
    }
    let state: DayState;
    if (den === 0) state = rest > 0 ? "rest" : "empty";
    else if (num / den >= 0.999) state = "full";
    else if (num > 0) state = "partial";
    else state = "none";
    out.push({ date: d, state, is_today: d === today });
  }
  return out;
}

/** Adesão agregada dos últimos `n` dias (mesma fórmula do hábito individual, somando todos). */
export function aggregateAdherence(rowsByHabit: RowsByHabit, endDate: string, n: number, minDays = 0): number | null {
  const from = addDays(endDate, -(n - 1));
  let num = 0;
  let den = 0;
  for (const rows of rowsByHabit.values()) {
    const t = tally(rows.filter((r) => r.date >= from && r.date <= endDate));
    num += t.num; den += t.den;
  }
  // Com poucos dias fechados a conta engana (1 dia feito = 100%): abaixo do mínimo, não mostra.
  return den === 0 || den < minDays ? null : num / den;
}

export interface WindowDelta {
  current: number | null;
  previous: number | null;
  /** Pontos percentuais; nulo sem 14 dias de dados em cada janela. */
  delta_pp: number | null;
}

/** Janela atual contra a imediatamente anterior, do mesmo tamanho. Só compara com dados suficientes nas duas. */
export function windowDelta(rowsByHabit: RowsByHabit, today: string, n: number, minClosedPerWindow = 4): WindowDelta {
  const current = aggregateAdherence(rowsByHabit, today, n);
  const prevEnd = addDays(today, -n);
  const previous = aggregateAdherence(rowsByHabit, prevEnd, n);
  const count = (end: string) => {
    const from = addDays(end, -(n - 1));
    let c = 0;
    for (const rows of rowsByHabit.values()) c += tally(rows.filter((r) => r.date >= from && r.date <= end)).den;
    return c;
  };
  const enough = count(today) >= minClosedPerWindow && count(prevEnd) >= minClosedPerWindow;
  return { current, previous, delta_pp: enough && current != null && previous != null ? Math.round((current - previous) * 100) : null };
}

export interface WeekdayStat {
  dow: number;
  adherence: number | null;
  n: number;
}

/** Adesão por dia da semana nos últimos `days` dias. Fica nula abaixo de `minN` dias previstos por dia da semana. */
export function weekdayAdherence(rowsByHabit: RowsByHabit, today: string, days = 84, minN = 4): WeekdayStat[] {
  const from = addDays(today, -(days - 1));
  const acc = Array.from({ length: 7 }, () => ({ num: 0, den: 0 }));
  for (const rows of rowsByHabit.values()) {
    for (const r of rows) {
      if (r.date < from || r.date > today) continue;
      const t = tally([r]);
      acc[dow(r.date)].num += t.num;
      acc[dow(r.date)].den += t.den;
    }
  }
  return acc.map((a, i) => ({ dow: i, n: a.den, adherence: a.den >= minN ? a.num / a.den : null }));
}


export interface WeekConsistency {
  /** Segunda-feira da semana. */
  week_start: string;
  /** 0 a 1; nulo se a semana não teve nenhum dia fechado previsto. */
  value: number | null;
  /** Dias de hábito (hábito × dia) que entraram na conta. */
  n: number;
  /** A semana ainda está em andamento. */
  current: boolean;
}

/** Constância semana a semana (segunda a domingo), das últimas `weeks` semanas. Só dias fechados entram; hoje fica de fora. */
export function weeklyConsistency(rowsByHabit: RowsByHabit, today: string, weeks = 12): WeekConsistency[] {
  const last = weekStart(today);
  const out: WeekConsistency[] = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const ws = addDays(last, -7 * k);
    const we = addDays(ws, 6);
    let num = 0;
    let den = 0;
    for (const rows of rowsByHabit.values()) {
      const t = tally(rows.filter((r) => r.date >= ws && r.date <= we && r.date < today));
      num += t.num; den += t.den;
    }
    out.push({ week_start: ws, value: den === 0 ? null : num / den, n: den, current: ws === last });
  }
  return out;
}

export interface Resilience {
  /** Dias não feitos (e fechados o bastante para saber como foi o dia seguinte). */
  lapses: number;
  /** Desses, quantos foram seguidos de um dia feito (completo ou versão mínima) no dia seguinte. */
  recovered: number;
  /** Dias salvos pela versão mínima (valem como feito) na janela. */
  minimum_days: number;
}

/**
 * "Nunca falhar duas vezes": depois de um dia não feito, a pessoa voltou no dia seguinte?
 * Só conta a falha cujo dia seguinte já fechou (antes de hoje), no mesmo hábito. Folga e dias não previstos não são falha nem retorno.
 */
export function resilience(rowsByHabit: RowsByHabit, today: string, n = 90): Resilience {
  const from = addDays(today, -(n - 1));
  let lapses = 0;
  let recovered = 0;
  let minimum_days = 0;
  for (const rows of rowsByHabit.values()) {
    const byDate = new Map(rows.map((r) => [r.date, r.outcome] as const));
    for (const r of rows) {
      if (r.date < from || r.date >= today) continue;
      if (r.outcome === "minimum") minimum_days += 1;
      if (r.outcome !== "missed") continue;
      const next = addDays(r.date, 1);
      if (next >= today) continue;
      const o = byDate.get(next);
      if (o === "done" || o === "minimum") { lapses += 1; recovered += 1; }
      else if (o === "missed") lapses += 1;
    }
  }
  return { lapses, recovered, minimum_days };
}

/** Dia da semana mais fraco, se for claramente pior que o melhor (pelo menos `gapPp` pontos percentuais de diferença). */
export function weakestWeekday(stats: WeekdayStat[], gapPp = 15): { dow: number; adherence: number; best: number } | null {
  const have = stats.filter((s): s is WeekdayStat & { adherence: number } => s.adherence != null);
  if (have.length < 5) return null;
  const worst = have.reduce((a, b) => (b.adherence < a.adherence ? b : a));
  const best = have.reduce((a, b) => (b.adherence > a.adherence ? b : a));
  return (best.adherence - worst.adherence) * 100 >= gapPp ? { dow: worst.dow, adherence: worst.adherence, best: best.adherence } : null;
}
