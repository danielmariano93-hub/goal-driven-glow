// Ritmo ao longo do dia e padrões por horário (puro, só para a interface; não é espelhado no servidor).
import { dayPace, PACE_SLEEP, PACE_WAKE, type DayPaceState } from "./forms";

// Horas sempre no relógio local da pessoa, de 0 a 24 (14,5 = 14h30).

/** Janela em que se espera que a pessoa esteja acordada (a meta do dia se distribui nela). */
export const DEFAULT_WAKE = PACE_WAKE;
export const DEFAULT_SLEEP = PACE_SLEEP;
/** Mínimo de dias com hora registrada antes de falar em "padrão". */
export const MIN_PATTERN_DAYS = 7;
/** Mínimo de vontades para apontar um horário difícil. */
export const MIN_CRAVINGS = 10;

/** Hora local (0 a 24) de um instante ISO no fuso informado. */
export function localHour(iso: string, timeZone: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  } catch {
    return null;
  }
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h + m / 60;
}

export interface TimedEntry {
  amount: number;
  hour: number;
}

export type RhythmState = DayPaceState;

export interface DayRhythm {
  /** Horas mostradas: de `from` (inclusive) até `to` (exclusivo). Cresce se houve registro fora da janela padrão. */
  from: number;
  to: number;
  /** Quantidade registrada em cada hora, da `from` à `to - 1`. */
  perHour: Array<{ hour: number; amount: number }>;
  /** Parte do total que não tem hora (registrada antes do ritmo existir ou em "dia anterior"). */
  untimed: number;
  /** Quanto já deveria ter sido feito agora, distribuindo a meta de forma uniforme entre acordar e dormir. */
  expected: number;
  /** expected - total: positivo = abaixo do ritmo. */
  gap: number;
  remaining: number;
  hours_left: number;
  /** Quanto por hora falta para fechar a meta no que resta do dia. Nulo se não há horas restantes ou a meta foi batida. */
  per_hour_needed: number | null;
  /** Meta dividida igualmente entre as horas acordado. */
  per_hour_plan: number;
  state: RhythmState;
}

/**
 * Ritmo do dia para uma meta de "no mínimo". Regras:
 *  - o esperado cresce em linha reta entre `wake` e `sleep` (antes de acordar: 0; depois de dormir: a meta toda);
 *  - "no ritmo" = até 10% da meta abaixo do esperado; mais que isso = "abaixo do ritmo";
 *  - bateu a meta = "done"; passou do horário de dormir sem bater = "closed" (sem cobrança de ritmo).
 */
export function dayRhythm(i: { target: number; total: number; entries: TimedEntry[]; nowHour: number; wake?: number; sleep?: number }): DayRhythm | null {
  const wake = i.wake ?? DEFAULT_WAKE;
  const sleep = i.sleep ?? DEFAULT_SLEEP;
  if (!(i.target > 0) || !(sleep > wake)) return null;
  const total = Math.max(0, i.total);
  const entries = i.entries.filter((e) => e.amount > 0 && e.hour >= 0 && e.hour < 24);
  const lo = entries.length ? Math.min(wake, Math.floor(Math.min(...entries.map((e) => e.hour)))) : wake;
  const hi = entries.length ? Math.max(sleep, Math.floor(Math.max(...entries.map((e) => e.hour))) + 1) : sleep;
  const perHour = Array.from({ length: hi - lo }, (_, k) => ({ hour: lo + k, amount: 0 }));
  for (const e of entries) perHour[Math.floor(e.hour) - lo].amount += e.amount;
  const timed = entries.reduce((a, e) => a + e.amount, 0);
  const pace = dayPace(i.target, total, i.nowHour, wake, sleep);
  if (!pace) return null;
  return {
    from: lo, to: hi, perHour, untimed: Math.max(0, total - timed), expected: pace.expected, gap: pace.gap, remaining: pace.remaining,
    hours_left: pace.hours_left, per_hour_needed: pace.per_hour_needed, per_hour_plan: pace.per_hour_plan, state: pace.state,
  };
}

export interface DatedEntry extends TimedEntry {
  local_date: string;
}

export interface HourPattern {
  /** Dias distintos com ao menos uma inclusão com hora. */
  days: number;
  /** Fatia do total por hora (0 a 1), 24 posições. */
  share: number[];
  /** Janela de 3 horas com mais volume, só se concentrar pelo menos 40% do total. */
  peak: { from: number; to: number; share: number } | null;
  /** Maior trecho de 3 horas ou mais seguidas com menos de 1% do total cada, entre a primeira e a última hora ativas (hora ativa = 3% ou mais). */
  quiet: { from: number; to: number } | null;
}

/** Padrão por horário. Nulo antes de MIN_PATTERN_DAYS dias com hora (cedo demais para falar em padrão). */
export function hourPattern(entries: DatedEntry[]): HourPattern | null {
  const good = entries.filter((e) => e.amount > 0 && e.hour >= 0 && e.hour < 24);
  const days = new Set(good.map((e) => e.local_date)).size;
  if (days < MIN_PATTERN_DAYS) return null;
  const sum = good.reduce((a, e) => a + e.amount, 0);
  if (sum <= 0) return null;
  const share = Array.from({ length: 24 }, () => 0);
  for (const e of good) share[Math.floor(e.hour)] += e.amount / sum;
  let best = -1;
  let bestFrom = 0;
  for (let h = 0; h <= 21; h++) {
    // em empate, prefere a janela que começa numa hora com registro (a janela "8h às 11h" quando só se bebeu às 9h e 10h seria estranha)
    const s = share[h] + share[h + 1] + share[h + 2] + (share[h] > 0 ? 1e-9 : 0);
    if (s > best) { best = s; bestFrom = h; }
  }
  const peakShare = share[bestFrom] + share[bestFrom + 1] + share[bestFrom + 2];
  const peak = peakShare >= 0.4 ? { from: bestFrom, to: bestFrom + 3, share: peakShare } : null;
  const active = share.map((s, h) => (s >= 0.03 ? h : -1)).filter((h) => h >= 0);
  let quiet: HourPattern["quiet"] = null;
  if (active.length >= 2) {
    const first = active[0];
    const last = active[active.length - 1];
    let h = first + 1;
    while (h < last) {
      if (share[h] >= 0.01) { h++; continue; }
      let e = h;
      while (e < last && share[e] < 0.01) e++;
      if (e - h >= 3 && (!quiet || e - h > quiet.to - quiet.from)) quiet = { from: h, to: e };
      h = e + 1;
    }
  }
  return { days, share, peak, quiet };
}

export interface CravingPoint {
  hour: number;
  handled: boolean | null;
}

export interface CravingHours {
  total: number;
  /** Vontades por hora, 24 posições: resistidas, cedidas e sem resposta. */
  perHour: Array<{ hour: number; resisted: number; ceded: number; open: number }>;
  resisted: number;
  answered: number;
  /** Janela de 3 horas com mais vontades, só se concentrar pelo menos 40% do total. */
  peak: { from: number; to: number; share: number } | null;
}

/** Vontades por hora. Nulo com menos de MIN_CRAVINGS vontades. */
export function cravingHours(points: CravingPoint[]): CravingHours | null {
  const good = points.filter((p) => p.hour >= 0 && p.hour < 24);
  if (good.length < MIN_CRAVINGS) return null;
  const perHour = Array.from({ length: 24 }, (_, hour) => ({ hour, resisted: 0, ceded: 0, open: 0 }));
  for (const p of good) {
    const row = perHour[Math.floor(p.hour)];
    if (p.handled === true) row.resisted++;
    else if (p.handled === false) row.ceded++;
    else row.open++;
  }
  const count = (h: number) => perHour[h].resisted + perHour[h].ceded + perHour[h].open;
  let best = -1;
  let bestFrom = 0;
  for (let h = 0; h <= 21; h++) {
    const s = count(h) + count(h + 1) + count(h + 2) + (count(h) > 0 ? 0.5 : 0);
    if (s > best) { best = s; bestFrom = h; }
  }
  const share = (count(bestFrom) + count(bestFrom + 1) + count(bestFrom + 2)) / good.length;
  const answered = good.filter((p) => p.handled != null).length;
  return {
    total: good.length, perHour, resisted: good.filter((p) => p.handled === true).length, answered,
    peak: share >= 0.4 ? { from: bestFrom, to: bestFrom + 3, share } : null,
  };
}

export interface WeekHistory {
  closed: number;
  met: number;
}

/** Semanas já fechadas (a atual fica de fora) e quantas bateram a meta, nas últimas `n`. */
export function weekHistory(weeks: Array<{ closed: boolean; met: boolean }>, n = 8): WeekHistory {
  const last = weeks.slice(-n).filter((w) => w.closed);
  return { closed: last.length, met: last.filter((w) => w.met).length };
}
