// NinoClock (`nino_clock.v1`) — relógio único do produto.
//
// O Nino é brasileiro: "hoje", "agora", "esta semana", "fechamento", "quiet
// hours" e dias úteis são sempre resolvidos no timezone LOCAL do usuário
// (default America/Sao_Paulo, identificador IANA — nunca offset fixo -03:00).
// Nenhum motor deve derivar data local com `new Date().toISOString()`.
import {
  DEFAULT_JURISDICTION,
  addDays,
  businessDayIndex,
  businessDaysBetween,
  isBusinessDay,
  remainingBusinessDays,
  type Jurisdiction,
} from "./brazilianCalendar";

export const NINO_CLOCK_VERSION = "nino_clock.v1";

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export type UserTemporalContext = {
  timezone: string;
  /** Instante em UTC (ISO completo). */
  now_utc: string;
  /** Data + hora locais, ISO sem offset (YYYY-MM-DDTHH:mm). */
  local_datetime: string;
  /** Data local (YYYY-MM-DD). */
  local_date: string;
  local_time: string;
  /** 0=domingo. */
  local_weekday: number;
  month: string; // YYYY-MM
  year: number;
  day_of_month: number;
  is_business_day: boolean;
  business_day_index: number;
  business_days_in_month_so_far: number;
  remaining_business_days: number;
  remaining_calendar_days: number;
  jurisdiction: Jurisdiction;
  version: string;
};

function partsIn(timezone: string, now: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) if (p.type !== "literal") out[p.type] = p.value;
  return out;
}

export function localDate(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const p = partsIn(timezone, now);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localTime(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const p = partsIn(timezone, now);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${hour}:${p.minute}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 2, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const target = new Date(Date.UTC(y, m, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthPeriod(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

export function startOfLocalDay(context: UserTemporalContext): string {
  return `${context.local_date}T00:00`;
}

/** Contexto temporal canônico do usuário. Todo motor recebe isto. */
export function buildTemporalContext(opts?: {
  timezone?: string | null;
  now?: Date;
  jurisdiction?: Jurisdiction;
}): UserTemporalContext {
  const timezone = opts?.timezone?.trim() || DEFAULT_TIMEZONE;
  const now = opts?.now ?? new Date();
  const jurisdiction = opts?.jurisdiction ?? DEFAULT_JURISDICTION;
  const p = partsIn(timezone, now);
  const local_date = `${p.year}-${p.month}-${p.day}`;
  const month = local_date.slice(0, 7);
  const monthEnd = monthPeriod(month).to;
  return {
    timezone,
    now_utc: now.toISOString(),
    local_datetime: `${local_date}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`,
    local_date,
    local_time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`,
    local_weekday: new Date(Date.parse(`${local_date}T12:00:00Z`)).getUTCDay(),
    month,
    year: Number(p.year),
    day_of_month: Number(p.day),
    is_business_day: isBusinessDay(local_date, jurisdiction),
    business_day_index: businessDayIndex(local_date, jurisdiction),
    business_days_in_month_so_far: businessDaysBetween(`${month}-01`, local_date, jurisdiction),
    remaining_business_days: remainingBusinessDays(local_date, jurisdiction),
    remaining_calendar_days: Math.max(
      0,
      Math.round((Date.parse(`${monthEnd}T12:00:00Z`) - Date.parse(`${local_date}T12:00:00Z`)) / 86400000),
    ),
    jurisdiction,
    version: NINO_CLOCK_VERSION,
  };
}

export function shift(date: string, days: number): string {
  return addDays(date, days);
}
