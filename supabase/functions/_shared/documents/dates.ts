// Resolução robusta de datas documentais em America/Sao_Paulo.
// Preserva datas legítimas, usa o período do extrato para datas parciais e
// evita substituir silenciosamente uma data válida por "hoje".

const TZ = "America/Sao_Paulo";
const DAY_MS = 86_400_000;

export function todaySaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isValidCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function toTime(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getTime();
}

function isFuture(iso: string, today: string, toleranceDays = 0): boolean {
  return (toTime(iso) - toTime(today)) / DAY_MS > toleranceDays;
}

function inPeriodWindow(iso: string, start?: string | null, end?: string | null, toleranceDays = 7): boolean {
  const t = toTime(iso);
  const min = start && isValidCalendarDate(start) ? toTime(start) - toleranceDays * DAY_MS : -Infinity;
  const max = end && isValidCalendarDate(end) ? toTime(end) + toleranceDays * DAY_MS : Infinity;
  return t >= min && t <= max;
}

export function inferYearFromPeriod(monthDay: string, period: { start?: string | null; end?: string | null }): number | null {
  const m = monthDay.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [mm, dd] = [m[1], m[2]];
  const candidates: number[] = [];
  if (period.start && isValidCalendarDate(period.start)) candidates.push(Number(period.start.slice(0, 4)));
  if (period.end && isValidCalendarDate(period.end)) candidates.push(Number(period.end.slice(0, 4)));
  for (const y of new Set(candidates)) {
    const iso = `${y}-${mm}-${dd}`;
    if (isValidCalendarDate(iso) && inPeriodWindow(iso, period.start, period.end, 0)) return y;
  }
  return candidates[0] ?? null;
}

export type DateResolutionContext = {
  statement_period_start?: string | null;
  statement_period_end?: string | null;
  today?: string;
};

export type DateResolution = {
  date: string;
  confidence: number;
  source: "iso" | "br_full" | "period_inferred" | "today_fallback" | "period_end_fallback";
  needs_review?: boolean;
};

/** Preferência: ISO explícito > dd/mm/yyyy > dd/mm inferido pelo período > período > hoje.
 *  Datas completas válidas e não-futuras são SEMPRE preservadas; se caírem fora do período do
 *  extrato, retornam com confiança reduzida (o pipeline pode marcar para revisão). */
export function resolveDocumentDate(raw: string | null | undefined, ctx: DateResolutionContext = {}): DateResolution {
  const today = ctx.today ?? todaySaoPaulo();
  const periodStart = ctx.statement_period_start && isValidCalendarDate(ctx.statement_period_start) ? ctx.statement_period_start : null;
  const periodEnd = ctx.statement_period_end && isValidCalendarDate(ctx.statement_period_end) ? ctx.statement_period_end : null;
  const fallback = periodEnd ?? today;
  const s = String(raw ?? "").trim();
  if (!s) return { date: fallback, confidence: 0.2, source: periodEnd ? "period_end_fallback" : "today_fallback", needs_review: true };

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const cand = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (isValidCalendarDate(cand) && !isFuture(cand, today, 0)) {
      const inWindow = inPeriodWindow(cand, periodStart, periodEnd);
      return { date: cand, confidence: inWindow ? 0.95 : 0.6, source: "iso", needs_review: !inWindow && !!(periodStart || periodEnd) };
    }
  }

  const brFull = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (brFull) {
    let y = brFull[3];
    if (y.length === 2) y = (Number(y) >= 70 ? "19" : "20") + y;
    const cand = `${y}-${brFull[2].padStart(2, "0")}-${brFull[1].padStart(2, "0")}`;
    if (isValidCalendarDate(cand) && !isFuture(cand, today, 0)) {
      const inWindow = inPeriodWindow(cand, periodStart, periodEnd);
      return { date: cand, confidence: inWindow ? 0.9 : 0.6, source: "br_full", needs_review: !inWindow && !!(periodStart || periodEnd) };
    }
  }

  const brPartial = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (brPartial) {
    const md = `${brPartial[2].padStart(2, "0")}-${brPartial[1].padStart(2, "0")}`;
    const year = inferYearFromPeriod(md, { start: periodStart, end: periodEnd });
    if (year) {
      const cand = `${year}-${md}`;
      if (isValidCalendarDate(cand) && !isFuture(cand, today, 0))
        return { date: cand, confidence: 0.8, source: "period_inferred" };
    }
  }

  return { date: fallback, confidence: 0.3, source: periodEnd ? "period_end_fallback" : "today_fallback", needs_review: true };
}
