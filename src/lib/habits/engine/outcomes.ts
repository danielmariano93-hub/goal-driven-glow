// Resultado de cada dia (modelo diário) e de cada semana (modelo semanal) de um hábito.
// Regras (doc seção 6.1): dia fechado sem registro é "missed"; o dia de hoje sem registro é "unlogged" (ainda aberto);
// folga ("rest") não pesa a favor nem contra; versão mínima vale 0,6 numa conta de adesão.
import { addDays, diffDays, dow, eachDay, maxDate, weekStart } from "./dates";
import type { DayRow, HabitDef, LogRow, Outcome, PauseRange, WeekRow } from "./types";

export const MINIMUM_WEIGHT = 0.6;
/** Quantidade parcial: a partir de metade da meta, um dia fechado conta como versão mínima. */
export const PARTIAL_MINIMUM_FROM = 0.5;

/** Hábitos de meta semanal (X por semana, ou quantidade por semana) são avaliados por semana, não por dia. */
export const isWeeklyModel = (h: HabitDef): boolean =>
  h.kind === "do_weekly_count" || (h.kind === "do_quantity" && h.quantity_period === "week");

/** Cuidado recorrente (consulta, exame, troca de filtro): não tem sequência, só "próximo em N dias". */
export const isRecurringModel = (h: HabitDef): boolean => h.form === "recurring" && (h.interval_days ?? 0) > 0;

const inPause = (date: string, pauses: PauseRange[]): boolean =>
  pauses.some((p) => date >= p.from && (p.to === null || date <= p.to));

/** O hábito (modelo diário) está previsto neste dia? */
export function isExpectedDay(h: HabitDef, date: string, pauses: PauseRange[] = []): boolean {
  if (date < h.started_on || inPause(date, pauses)) return false;
  return h.days_of_week == null || h.days_of_week.length === 0 || h.days_of_week.includes(dow(date));
}

function logOutcome(h: HabitDef, log: LogRow): Outcome {
  switch (log.status) {
    case "done":
      return "done";
    case "minimum":
      return "minimum";
    case "rest":
      return "rest";
    case "skipped":
      return "missed";
    case "quantity": {
      const q = log.quantity ?? 0;
      // Valor acompanhado (peso, humor…): registrar já vale como feito.
      if (h.direction === "track") return q > 0 ? "done" : "missed";
      // Teto ou horário: quanto menor, melhor. Até 20% acima do limite ainda conta como versão mínima.
      if (h.direction === "at_most") {
        const limit = h.quantity_target ?? 0;
        if (q <= limit) return "done";
        return q <= limit * 1.2 ? "minimum" : "missed";
      }
      if (h.quantity_target != null && q >= h.quantity_target) return "done";
      return q > 0 ? "minimum" : "missed";
    }
  }
}

export function dayOutcome(h: HabitDef, log: LogRow | undefined, date: string, today: string, pauses: PauseRange[] = []): Outcome {
  if (!isExpectedDay(h, date, pauses) || date > today) return "not_expected";
  if (log) {
    // Quantidade abaixo da meta: hoje o dia ainda está aberto (a pessoa pode seguir registrando); num dia fechado,
    // metade da meta ou mais vale como versão mínima e menos que isso não conta.
    if (log.status === "quantity" && h.direction !== "at_most" && h.direction !== "track" && (h.quantity_target ?? 0) > 0) {
      const q = log.quantity ?? 0;
      const target = h.quantity_target as number;
      if (q > 0 && q < target) return date === today ? "unlogged" : q >= target * PARTIAL_MINIMUM_FROM ? "minimum" : "missed";
    }
    // Teto (tempo de tela, cafés): enquanto o dia está aberto e o limite não foi passado, o resultado ainda pode mudar.
    // Passou do limite, já não tem volta e o resultado vale na hora.
    if (h.form === "ceiling" && log.status === "quantity" && date === today && (log.quantity ?? 0) <= (h.quantity_target ?? 0)) return "unlogged";
    // Rotina em passos: com só parte dos passos o dia ainda está aberto; só fecha como versão mínima à meia-noite.
    if (h.form === "steps" && log.status === "minimum" && date === today) return "unlogged";
    return logOutcome(h, log);
  }
  if (date === today) return "unlogged";
  // Teto: sem registro num dia fechado significa que não passou do limite.
  return h.implicit_ok ? "done" : "missed";
}

/** Linhas de dia entre `from` e `to`. No modelo semanal, só aparece o que a pessoa registrou. */
export function dayRows(h: HabitDef, logs: LogRow[], from: string, to: string, today: string, pauses: PauseRange[] = []): DayRow[] {
  const byDate = new Map<string, LogRow>();
  for (const l of logs) if (l.habit_id === h.id) byDate.set(l.local_date, l);
  const weekly = isWeeklyModel(h);
  return eachDay(from, to).map((date) => {
    const log = byDate.get(date);
    if (weekly) {
      if (date < h.started_on || date > today || !log) return { date, outcome: "not_expected" as Outcome };
      if (log.status === "quantity") return { date, outcome: ((log.quantity ?? 0) > 0 ? "done" : "missed") as Outcome };
      return { date, outcome: logOutcome(h, log) };
    }
    return { date, outcome: dayOutcome(h, log, date, today, pauses) };
  });
}

/** Semanas ISO do hábito, da primeira à corrente. A primeira semana é proporcional se o hábito começou no meio dela. */
export function weekRows(h: HabitDef, logs: LogRow[], today: string, pauses: PauseRange[] = []): WeekRow[] {
  if (!isWeeklyModel(h)) return [];
  const isQuantity = h.kind === "do_quantity";
  const baseTarget = isQuantity ? h.quantity_target ?? 0 : h.weekly_target ?? 0;
  if (baseTarget <= 0 || h.started_on > today) return [];
  const mine = logs.filter((l) => l.habit_id === h.id);
  const rows: WeekRow[] = [];
  for (let w = weekStart(h.started_on); w <= weekStart(today); w = addDays(w, 7)) {
    const from = maxDate(w, h.started_on);
    const avail = eachDay(from, addDays(w, 6)).filter((d) => !inPause(d, pauses)).length;
    if (avail === 0) continue;
    const prorated = avail === 7 ? baseTarget : baseTarget * (avail / 7);
    const target = isQuantity ? Math.max(prorated, 0.0001) : Math.max(1, Math.round(prorated));
    let count = 0;
    for (const l of mine) {
      if (l.local_date < w || l.local_date > addDays(w, 6)) continue;
      if (isQuantity) {
        if (l.status === "quantity") count += l.quantity ?? 0;
      } else if (l.status === "done") count += 1;
      else if (l.status === "minimum") count += MINIMUM_WEIGHT;
    }
    const progress = Math.min(1, count / target);
    rows.push({ week_start: w, target, count, progress, closed: addDays(w, 6) < today, met: progress >= 1 });
  }
  return rows;
}

export const daysBetween = diffDays;
