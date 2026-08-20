// Calendário de dias úteis brasileiro (`brazilian_business_calendar.v1`).
//
// Fonte única e versionada de feriados. Nenhum motor pode ter lista própria de
// feriados, nem decidir dia útil por conta própria — e a LLM nunca decide isso.
// Datas sempre em YYYY-MM-DD (data LOCAL do usuário, resolvida pelo NinoClock).

export const BRAZILIAN_CALENDAR_VERSION = "brazilian_business_calendar.v1";

export type Jurisdiction = {
  country: "BR";
  /** Preparado para feriados estaduais (ex.: "SP"). Ainda não populado. */
  state_code?: string | null;
  /** Preparado para feriados municipais (ex.: "3550308"). Ainda não populado. */
  city_code?: string | null;
};

export type Holiday = {
  date: string;
  name: string;
  scope: "national" | "state" | "city";
  movable: boolean;
};

export const DEFAULT_JURISDICTION: Jurisdiction = { country: "BR" };

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function utc(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtc(utc(date) + days * 86400000);
}

/** Domingo de Páscoa (algoritmo gregoriano anônimo) — nunca hardcodado. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** Feriados nacionais do ano — fixos + móveis derivados da Páscoa. */
export function getHolidays(year: number, jurisdiction: Jurisdiction = DEFAULT_JURISDICTION): Holiday[] {
  const easter = easterSunday(year);
  const list: Holiday[] = [
    { date: ymd(year, 1, 1), name: "Confraternização Universal", scope: "national", movable: false },
    { date: addDays(easter, -48), name: "Carnaval", scope: "national", movable: true },
    { date: addDays(easter, -47), name: "Carnaval", scope: "national", movable: true },
    { date: addDays(easter, -2), name: "Sexta-feira Santa", scope: "national", movable: true },
    { date: ymd(year, 4, 21), name: "Tiradentes", scope: "national", movable: false },
    { date: ymd(year, 5, 1), name: "Dia do Trabalho", scope: "national", movable: false },
    { date: addDays(easter, 60), name: "Corpus Christi", scope: "national", movable: true },
    { date: ymd(year, 9, 7), name: "Independência do Brasil", scope: "national", movable: false },
    { date: ymd(year, 10, 12), name: "Nossa Senhora Aparecida", scope: "national", movable: false },
    { date: ymd(year, 11, 2), name: "Finados", scope: "national", movable: false },
    { date: ymd(year, 11, 15), name: "Proclamação da República", scope: "national", movable: false },
    { date: ymd(year, 12, 25), name: "Natal", scope: "national", movable: false },
  ];
  // Consciência Negra virou feriado nacional a partir de 2024 (Lei 14.759/2023).
  if (year >= 2024) {
    list.push({ date: ymd(year, 11, 20), name: "Consciência Negra", scope: "national", movable: false });
  }
  void jurisdiction; // estaduais/municipais entram aqui quando houver localização do usuário.
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

const holidayCache = new Map<string, Set<string>>();

function holidaySet(year: number, jurisdiction: Jurisdiction): Set<string> {
  const key = `${year}|${jurisdiction.state_code ?? ""}|${jurisdiction.city_code ?? ""}`;
  const cached = holidayCache.get(key);
  if (cached) return cached;
  const set = new Set(getHolidays(year, jurisdiction).map((h) => h.date));
  holidayCache.set(key, set);
  return set;
}

export function isHoliday(date: string, jurisdiction: Jurisdiction = DEFAULT_JURISDICTION): boolean {
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return holidaySet(year, jurisdiction).has(date.slice(0, 10));
}

export function weekdayOfDate(date: string): number {
  return new Date(utc(date)).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const w = weekdayOfDate(date);
  return w === 0 || w === 6;
}

export function isBusinessDay(date: string, jurisdiction: Jurisdiction = DEFAULT_JURISDICTION): boolean {
  return !isWeekend(date) && !isHoliday(date, jurisdiction);
}

/** Ordinal do dia útil dentro do mês (1-based). 0 quando a data não é dia útil. */
export function businessDayIndex(date: string, jurisdiction: Jurisdiction = DEFAULT_JURISDICTION): number {
  const d = date.slice(0, 10);
  if (!isBusinessDay(d, jurisdiction)) return 0;
  const first = `${d.slice(0, 7)}-01`;
  let index = 0;
  for (let cursor = first; cursor <= d; cursor = addDays(cursor, 1)) {
    if (isBusinessDay(cursor, jurisdiction)) index += 1;
  }
  return index;
}

/** Data do n-ésimo dia útil do mês; null quando o mês não tem n dias úteis. */
export function getNthBusinessDay(
  year: number,
  month: number,
  n: number,
  jurisdiction: Jurisdiction = DEFAULT_JURISDICTION,
): string | null {
  if (n < 1) return null;
  const first = ymd(year, month, 1);
  const monthKey = first.slice(0, 7);
  let count = 0;
  for (let cursor = first; cursor.slice(0, 7) === monthKey; cursor = addDays(cursor, 1)) {
    if (isBusinessDay(cursor, jurisdiction)) {
      count += 1;
      if (count === n) return cursor;
    }
  }
  return null;
}

export function businessDaysBetween(
  from: string,
  to: string,
  jurisdiction: Jurisdiction = DEFAULT_JURISDICTION,
): number {
  if (to < from) return 0;
  let count = 0;
  for (let cursor = from.slice(0, 10); cursor <= to.slice(0, 10); cursor = addDays(cursor, 1)) {
    if (isBusinessDay(cursor, jurisdiction)) count += 1;
  }
  return count;
}

export function businessDaysInMonth(
  year: number,
  month: number,
  jurisdiction: Jurisdiction = DEFAULT_JURISDICTION,
): number {
  const first = ymd(year, month, 1);
  const last = ymd(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return businessDaysBetween(first, last, jurisdiction);
}

/**
 * Período equivalente em DIAS ÚTEIS no mês alvo: preserva a quantidade de dias
 * úteis do período de origem (1º dia útil → N-ésimo dia útil).
 * Retorna null quando o mês alvo não possui dias úteis suficientes.
 */
export function getEquivalentBusinessPeriod(
  period: { from: string; to: string },
  targetMonth: string,
  jurisdiction: Jurisdiction = DEFAULT_JURISDICTION,
): { from: string; to: string; business_days: number } | null {
  const n = businessDaysBetween(period.from, period.to, jurisdiction);
  if (n <= 0) return null;
  const [y, m] = targetMonth.split("-").map(Number);
  const start = getNthBusinessDay(y, m, 1, jurisdiction);
  const end = getNthBusinessDay(y, m, n, jurisdiction);
  if (!start || !end) return null;
  return { from: start, to: end, business_days: n };
}

/** Dias úteis restantes no mês da data (inclui a própria data quando útil). */
export function remainingBusinessDays(date: string, jurisdiction: Jurisdiction = DEFAULT_JURISDICTION): number {
  const d = date.slice(0, 10);
  const [y, m] = d.split("-").map(Number);
  const last = ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return businessDaysBetween(d, last, jurisdiction);
}
