// Regularidade do horário (puro, só para a interface). Usa a hora em que o registro foi feito (hb_logs.logged_at).
// O dia do hábito vira às 03:00 (como no resto do app): um registro às 01:00 pertence ao dia anterior e é "tarde da noite", não "madrugada".
import { addDays } from "./dates";

/** Mínimo de dias com horário confiável antes de falar em regularidade. */
export const MIN_REGULARITY_DAYS = 7;
/** Margem para considerar "no horário": 1 hora para cada lado do horário típico. */
export const REGULARITY_WINDOW_MIN = 60;
const TURNOVER_MIN = 3 * 60;

export interface LogTime {
  habit_id: string;
  local_date: string;
  status: string;
  source: string;
  logged_at: string | null;
}

/** Data e minutos (desde 00:00) de um instante no fuso informado. */
export function localParts(iso: string, timeZone: string): { date: string; minutes: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  } catch {
    return null;
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const h = Number(get("hour"));
  const m = Number(get("minute"));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: h * 60 + m };
}

/** "07:40" a partir de minutos desde 00:00. */
export const clockText = (minutes: number): string => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export interface Regularity {
  /** Dias com horário confiável. */
  days: number;
  /** Horário típico (mediana), em minutos desde 00:00. */
  typical_min: number;
  /** Dias em que o registro ficou a até 1 hora do horário típico. */
  within: number;
  /** within / days. */
  share: number;
}

/**
 * Horários confiáveis de um hábito: só marcação feita no próprio dia (o dia do registro, com virada às 03:00, é o dia do hábito),
 * nunca "dia anterior"/retroativo, e só os dias feitos. Nulo com menos de MIN_REGULARITY_DAYS dias.
 */
export function regularity(logs: LogTime[], timeZone: string): Regularity | null {
  const seen = new Set<string>();
  const shifted: number[] = [];
  for (const l of logs) {
    if (!l.logged_at || l.source === "backfill" || !(l.status === "done" || l.status === "minimum" || l.status === "quantity")) continue;
    const p = localParts(l.logged_at, timeZone);
    if (!p) continue;
    const habitDay = p.minutes < TURNOVER_MIN ? addDays(p.date, -1) : p.date;
    if (habitDay !== l.local_date || seen.has(l.local_date)) continue;
    seen.add(l.local_date);
    shifted.push((p.minutes - TURNOVER_MIN + 1440) % 1440);
  }
  if (shifted.length < MIN_REGULARITY_DAYS) return null;
  const sorted = [...shifted].sort((a, b) => a - b);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const within = shifted.filter((m) => Math.abs(m - mid) <= REGULARITY_WINDOW_MIN).length;
  return { days: shifted.length, typical_min: (mid + TURNOVER_MIN) % 1440, within, share: within / shifted.length };
}

/** Formas de medir em que o horário do toque diz algo sobre quando o hábito acontece. Água (várias vezes), horário, teto e valor ficam de fora. */
export const REGULARITY_FORMS = new Set(["check", "weekly", "duration", "project", "steps"]);
