import { computeBehavioralExpense, round2, isGrossCardMovement, type TransactionRow } from "./facts";

export interface DateRange { start: string; end: string }
export interface DailyAverage { total: number; days: number; avg: number }
export type Trend = "up" | "down" | "stable";
export interface DailyAverageComparison {
  current: DailyAverage;
  previous: DailyAverage;
  currentRange: DateRange;
  prevRange: DateRange;
  /** Diferença percentual (current - previous)/previous * 100. null quando previous.avg = 0. */
  deltaPct: number | null;
  trend: Trend;
}

/** Parse YYYY-MM-DD como data local (sem drift UTC). */
function parseLocal(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function lastDayOfMonth(year: number, monthZero: number): number {
  return new Date(year, monthZero + 1, 0).getDate();
}

/** Dias corridos inclusivos entre start e end (mesma data = 1). Retorna 0 se inválido. */
export function daysInclusive(start: string, end: string): number {
  const s = parseLocal(start);
  const e = parseLocal(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  if (e < s) return 0;
  const ms = e.getTime() - s.getTime();
  return Math.round(ms / 86400000) + 1;
}

/** Desloca a data em 1 mês para trás, clampando ao último dia válido. */
function shiftDatePrevMonth(iso: string): string {
  const d = parseLocal(iso);
  if (isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const prevYear = m === 0 ? y - 1 : y;
  const prevMonth = m === 0 ? 11 : m - 1;
  const maxDay = lastDayOfMonth(prevYear, prevMonth);
  const safeDay = Math.min(day, maxDay);
  return isoLocal(new Date(prevYear, prevMonth, safeDay));
}

/** Desloca intervalo em 1 mês, clampando cada extremo. */
export function shiftRangePrevMonth(range: DateRange): DateRange {
  return { start: shiftDatePrevMonth(range.start), end: shiftDatePrevMonth(range.end) };
}

export function computeDailyAverage(txs: TransactionRow[], range: DateRange): DailyAverage {
  const days = daysInclusive(range.start, range.end);
  if (days <= 0) return { total: 0, days: 0, avg: 0 };
  const total = computeBehavioralExpense(txs, range);
  const avg = round2(total / days);
  return { total, days, avg };
}

export function computeDailyAverageComparison(
  txs: TransactionRow[],
  range: DateRange,
): DailyAverageComparison {
  const current = computeDailyAverage(txs, range);
  const prevRange = shiftRangePrevMonth(range);
  const previous = computeDailyAverage(txs, prevRange);
  let deltaPct: number | null = null;
  let trend: Trend = "stable";
  if (previous.avg > 0) {
    deltaPct = round2(((current.avg - previous.avg) / previous.avg) * 100);
    if (Math.abs(deltaPct) < 1) trend = "stable";
    else trend = deltaPct > 0 ? "up" : "down";
  } else if (current.avg > 0) {
    trend = "up";
  }
  return { current, previous, currentRange: range, prevRange, deltaPct, trend };
}

const MONTHS_SHORT = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

/** Formata intervalo como "1–21 jun." ou "28 fev. – 3 mar." */
export function formatRangeShort(range: DateRange): string {
  const s = parseLocal(range.start);
  const e = parseLocal(range.end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return "";
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    if (s.getDate() === e.getDate()) return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]}`;
    return `${s.getDate()}–${e.getDate()} ${MONTHS_SHORT[s.getMonth()]}`;
  }
  return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]}`;
}
