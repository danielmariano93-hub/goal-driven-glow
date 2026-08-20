// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Calendário de dias úteis brasileiro (`brazilian_business_calendar.v1`).
//
// Fonte única e versionada de feriados. Nenhum motor pode ter lista própria de
// feriados, nem decidir dia útil por conta própria — e a LLM nunca decide isso.
// Datas sempre em YYYY-MM-DD (data LOCAL do usuário, resolvida pelo NinoClock).

export const BRAZILIAN_CALENDAR_VERSION = "brazilian_business_calendar.v2";

/**
 * Perfil de calendário. O Nino é um produto financeiro: por padrão, "dia útil"
 * é o dia em que existe LIQUIDAÇÃO BANCÁRIA (BR_FINANCIAL). Carnaval, Sexta-feira
 * Santa e Corpus Christi não são feriados nacionais civis — são pontos
 * facultativos com bancos fechados por decisão da Febraban/BACEN. Por isso eles
 * contam como dia útil em BR_CIVIL e como dia NÃO útil em BR_FINANCIAL.
 */
export type CalendarProfile = "BR_CIVIL" | "BR_FINANCIAL" | "BR_LOCAL";

export type Jurisdiction = {
  country: "BR";
  /** Perfil aplicado ao decidir dia útil. Default do Nino: BR_FINANCIAL. */
  calendar_profile?: CalendarProfile;
  /** Preparado para feriados estaduais (ex.: "SP"). Só usado em BR_LOCAL. */
  state_code?: string | null;
  /** Preparado para feriados municipais (ex.: "3550308"). Só usado em BR_LOCAL. */
  city_code?: string | null;
};

/** Natureza legal do dia não trabalhado. */
export type HolidayPolicy =
  /** Feriado nacional civil (Lei federal) — fecha tudo. */
  | "national_statutory"
  /** Ponto facultativo com bancos fechados (Carnaval, Sexta Santa, Corpus Christi). */
  | "bank_closed"
  /** Feriado estadual. */
  | "state_statutory"
  /** Feriado municipal. */
  | "city_statutory";

export type Holiday = {
  date: string;
  name: string;
  scope: "national" | "state" | "city";
  movable: boolean;
  policy: HolidayPolicy;
};

export const DEFAULT_CALENDAR_PROFILE: CalendarProfile = "BR_FINANCIAL";

export const DEFAULT_JURISDICTION: Jurisdiction = {
  country: "BR",
  calendar_profile: DEFAULT_CALENDAR_PROFILE,
};

export function profileOf(jurisdiction: Jurisdiction = DEFAULT_JURISDICTION): CalendarProfile {
  return jurisdiction.calendar_profile ?? DEFAULT_CALENDAR_PROFILE;
}

/** Políticas que contam como dia NÃO útil em cada perfil. */
export function activePolicies(profile: CalendarProfile): HolidayPolicy[] {
  switch (profile) {
    case "BR_CIVIL": return ["national_statutory"];
    case "BR_LOCAL": return ["national_statutory", "bank_closed", "state_statutory", "city_statutory"];
    case "BR_FINANCIAL":
    default: return ["national_statutory", "bank_closed"];
  }
}


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

/**
 * Feriados e dias de bancos fechados do ano — fixos + móveis derivados da
 * Páscoa. A lista é sempre completa; quem filtra por `policy` é `isBusinessDay`
 * segundo o `calendar_profile` da jurisdição.
 */
export function getHolidays(year: number, jurisdiction: Jurisdiction = DEFAULT_JURISDICTION): Holiday[] {
  const easter = easterSunday(year);
  const nat = (date: string, name: string, movable = false): Holiday =>
    ({ date, name, scope: "national", movable, policy: "national_statutory" });
  const bank = (date: string, name: string): Holiday =>
    ({ date, name, scope: "national", movable: true, policy: "bank_closed" });
  const list: Holiday[] = [
    nat(ymd(year, 1, 1), "Confraternização Universal"),
    bank(addDays(easter, -48), "Carnaval"),
    bank(addDays(easter, -47), "Carnaval"),
    bank(addDays(easter, -2), "Sexta-feira Santa"),
    nat(ymd(year, 4, 21), "Tiradentes"),
    nat(ymd(year, 5, 1), "Dia do Trabalho"),
    bank(addDays(easter, 60), "Corpus Christi"),
    nat(ymd(year, 9, 7), "Independência do Brasil"),
    nat(ymd(year, 10, 12), "Nossa Senhora Aparecida"),
    nat(ymd(year, 11, 2), "Finados"),
    nat(ymd(year, 11, 15), "Proclamação da República"),
    nat(ymd(year, 12, 25), "Natal"),
  ];
  // Consciência Negra virou feriado nacional a partir de 2024 (Lei 14.759/2023).
  if (year >= 2024) list.push(nat(ymd(year, 11, 20), "Consciência Negra"));
  void jurisdiction; // estaduais/municipais entram aqui quando houver localização do usuário.
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

const holidayCache = new Map<string, Set<string>>();

function holidaySet(year: number, jurisdiction: Jurisdiction): Set<string> {
  const profile = profileOf(jurisdiction);
  const key = `${year}|${profile}|${jurisdiction.state_code ?? ""}|${jurisdiction.city_code ?? ""}`;
  const cached = holidayCache.get(key);
  if (cached) return cached;
  const allowed = new Set<HolidayPolicy>(activePolicies(profile));
  const set = new Set(
    getHolidays(year, jurisdiction).filter((h) => allowed.has(h.policy)).map((h) => h.date),
  );
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

/**
 * DUAS COISAS DIFERENTES — nunca implícitas:
 *
 * - `BUSINESS_DAY_INDEXED_PERIOD`: a JANELA é delimitada por dias úteis
 *   (1º dia útil → N-ésimo dia útil), mas TODOS os dias corridos dentro dela
 *   entram na soma. É o recorte certo para "MTD equivalente".
 * - `BUSINESS_DAYS_ONLY`: dentro da janela, apenas as transações cuja data cai
 *   em dia útil entram na soma. É o recorte certo para "gastei mais nos mesmos
 *   dias úteis" e para métricas de liquidação bancária.
 */
export type DaySelection = "CHRONOLOGICAL" | "BUSINESS_DAYS_ONLY";

export const DAY_SELECTION_LABEL_PT: Record<DaySelection, string> = {
  CHRONOLOGICAL: "todos os dias corridos da janela",
  BUSINESS_DAYS_ONLY: "somente dias úteis da janela",
};

/** Lista de dias úteis do período (inclusivo). */
export function listBusinessDays(
  from: string,
  to: string,
  jurisdiction: Jurisdiction = DEFAULT_JURISDICTION,
): string[] {
  const out: string[] = [];
  if (to < from) return out;
  for (let cursor = from.slice(0, 10); cursor <= to.slice(0, 10); cursor = addDays(cursor, 1)) {
    if (isBusinessDay(cursor, jurisdiction)) out.push(cursor);
  }
  return out;
}

/** A data participa da soma segundo o `day_selection` escolhido? */
export function includedByDaySelection(
  date: string,
  selection: DaySelection,
  jurisdiction: Jurisdiction = DEFAULT_JURISDICTION,
): boolean {
  if (selection === "CHRONOLOGICAL") return true;
  return isBusinessDay(date.slice(0, 10), jurisdiction);
}

/**
 * Janela indexada por dias úteis: mesmo N de dias úteis, todos os dias corridos
 * entre o 1º e o N-ésimo entram. Alias explícito de `getEquivalentBusinessPeriod`
 * para que o chamador declare qual das duas semânticas quer.
 */
export function getBusinessDayIndexedPeriod(
  period: { from: string; to: string },
  targetMonth: string,
  jurisdiction: Jurisdiction = DEFAULT_JURISDICTION,
): { from: string; to: string; business_days: number } | null {
  return getEquivalentBusinessPeriod(period, targetMonth, jurisdiction);
}


/** Dias úteis restantes no mês da data (inclui a própria data quando útil). */
export function remainingBusinessDays(date: string, jurisdiction: Jurisdiction = DEFAULT_JURISDICTION): number {
  const d = date.slice(0, 10);
  const [y, m] = d.split("-").map(Number);
  const last = ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return businessDaysBetween(d, last, jurisdiction);
}
