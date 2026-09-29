// ExplicitPeriodResolver (`period_truth.v3-explicit`)
//
// Deterministic resolution for absolute dates/ranges that must never be
// reinterpreted by later language layers. This module is intentionally pure:
// it receives an already-identified temporal expression and returns dates.

import { todaySP, type ResolvedPeriod } from "./periodResolver.ts";

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymd(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > lastDayOfMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 + 1 };
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function labelOf(from: string, to: string): string {
  const br = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
  return from === to ? br(from) : `${br(from)} a ${br(to)}`;
}

function range(from: string, to: string, matched: string): ResolvedPeriod | null {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(from) || !/^20\d{2}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to, label: labelOf(from, to), matched, complete: true, kind: from === to ? "day" : "range" };
}

function parseSlashDate(dayRaw: string, monthRaw: string, yearRaw: string | undefined, today: string): string | null {
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const [todayYear, todayMonth] = today.split("-").map(Number);
  let year = yearRaw ? Number(yearRaw) : todayYear;
  if (!yearRaw && month > todayMonth) year -= 1;
  return ymd(year, month, day);
}

function lastWeek(today: string): { from: string; to: string } {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisMonday = shiftDay(today, -((dow + 6) % 7));
  return { from: shiftDay(thisMonday, -7), to: shiftDay(thisMonday, -1) };
}

function inferDayOnlyRange(startDay: number, endDay: number, text: string, today: string): ResolvedPeriod | null {
  const [year, month, todayDay] = today.split("-").map(Number);
  const t = norm(text);

  if (/\b(semana passada|ultima semana)\b/.test(t)) {
    const week = lastWeek(today);
    const [wy, wm] = week.from.split("-").map(Number);
    const start = ymd(wy, wm, startDay);
    let endYear = wy;
    let endMonth = wm;
    if (endDay < startDay) {
      const shifted = shiftMonth(wy, wm, 1);
      endYear = shifted.year;
      endMonth = shifted.month;
    }
    const end = ymd(endYear, endMonth, endDay);
    if (!start || !end) return null;
    // The anchor is authoritative: day-only range must overlap the named week.
    if (end < week.from || start > week.to) return null;
    return range(start, end, text);
  }

  // Without an explicit calendar anchor, choose the most recent plausible
  // same-month interval. This makes "do dia 21 ao 27" on the 28th mean the
  // current month, and on the 2nd mean the previous month rather than a future
  // interval. Cross-month day-only ranges require an explicit month/year.
  if (endDay < startDay) return null;
  const base = endDay <= todayDay ? { year, month } : shiftMonth(year, month, -1);
  const start = ymd(base.year, base.month, startDay);
  const end = ymd(base.year, base.month, endDay);
  return start && end ? range(start, end, text) : null;
}

/**
 * Resolve only EXPLICIT absolute/date-range expressions. Relative language
 * ("mês passado", "últimos 30 dias") remains in PeriodResolver.
 */
export function resolveExplicitPeriodPt(text: string, now: Date = new Date()): ResolvedPeriod | null {
  const raw = String(text ?? "").trim();
  const t = norm(raw);
  if (!t) return null;
  const today = todaySP(now);

  // Canonical internal form emitted by V3 temporal grounding.
  const canonical = t.match(/\b(20\d{2}-\d{2}-\d{2})\s*(?:\.\.|a|ate)\s*(20\d{2}-\d{2}-\d{2})\b/);
  if (canonical) return range(canonical[1], canonical[2], raw);

  // ISO single day.
  const isoDay = t.match(/^\s*(20\d{2}-\d{2}-\d{2})\s*$/);
  if (isoDay) return range(isoDay[1], isoDay[1], raw);

  // 21/09/2026 a 27/09/2026, year optional on either side.
  const slashRange = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\s*(?:a|ate|ao|-)\s*(?:dia\s*)?(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (slashRange) {
    const from = parseSlashDate(slashRange[1], slashRange[2], slashRange[3], today);
    let to = parseSlashDate(slashRange[4], slashRange[5], slashRange[6] ?? slashRange[3], today);
    if (from && to && to < from && !slashRange[6] && !slashRange[3]) {
      const [fy] = from.split("-").map(Number);
      to = ymd(fy + 1, Number(slashRange[5]), Number(slashRange[4]));
    }
    return from && to ? range(from, to, raw) : null;
  }

  // 21/09 ao dia 27: second month inherited from first.
  const inheritedMonth = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\s*(?:a|ate|ao|-)\s*(?:dia\s*)?(\d{1,2})\b/);
  if (inheritedMonth) {
    const from = parseSlashDate(inheritedMonth[1], inheritedMonth[2], inheritedMonth[3], today);
    if (!from) return null;
    const [fy, fm] = from.split("-").map(Number);
    const to = ymd(fy, fm, Number(inheritedMonth[4]));
    return to ? range(from, to, raw) : null;
  }

  // Day-only ranges: "do dia 21 ao dia 27", "21 a 27", semantic "21-27".
  const dayRange = t.match(/(?:\bdo\s+)?\bdia\s*(\d{1,2})\s*(?:ao|a|ate|-)\s*(?:dia\s*)?(\d{1,2})\b/)
    ?? (/^(?:dia\s*)?(\d{1,2})\s*(?:a|ate|ao|-)\s*(?:dia\s*)?(\d{1,2})$/.exec(t));
  if (dayRange) return inferDayOnlyRange(Number(dayRange[1]), Number(dayRange[2]), raw, today);

  // Single dd/mm[/yyyy].
  const singleSlash = t.match(/^\s*(?:dia\s*)?(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\s*$/);
  if (singleSlash) {
    const day = parseSlashDate(singleSlash[1], singleSlash[2], singleSlash[3], today);
    return day ? range(day, day, raw) : null;
  }

  return null;
}

export function canonicalPeriodExpression(period: Pick<ResolvedPeriod, "from" | "to">): string {
  return `${period.from}..${period.to}`;
}
