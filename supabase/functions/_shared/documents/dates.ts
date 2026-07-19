// Resolução robusta de datas documentais em America/Sao_Paulo.
// Nunca aceita data futura sem evidência explícita; nunca vira o ano automaticamente.

const TZ = "America/Sao_Paulo";

export function todaySaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isValidCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export function inferYearFromPeriod(monthDay: string, period: { start?: string | null; end?: string | null }): number | null {
  const m = monthDay.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [mm, dd] = [m[1], m[2]];
  const candidates: number[] = [];
  if (period.start) candidates.push(Number(period.start.slice(0, 4)));
  if (period.end) candidates.push(Number(period.end.slice(0, 4)));
  for (const y of new Set(candidates)) {
    const iso = `${y}-${mm}-${dd}`;
    if (!isValidCalendarDate(iso)) continue;
    const t = new Date(`${iso}T12:00:00Z`).getTime();
    const s = period.start ? new Date(`${period.start}T00:00:00Z`).getTime() : -Infinity;
    const e = period.end ? new Date(`${period.end}T23:59:59Z`).getTime() : Infinity;
    if (t >= s && t <= e) return y;
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
};

/** Resolve uma data documental. Preferência: ISO explícito > dd/mm/yyyy > dd/mm inferido pelo período > período > hoje. */
export function resolveDocumentDate(raw: string | null | undefined, ctx: DateResolutionContext = {}): DateResolution {
  const today = ctx.today ?? todaySaoPaulo();
  const periodEnd = ctx.statement_period_end && isValidCalendarDate(ctx.statement_period_end) ? ctx.statement_period_end : null;
  const fallback = periodEnd ?? today;
  const s = String(raw ?? "").trim();
  if (!s) return { date: fallback, confidence: 0.2, source: periodEnd ? "period_end_fallback" : "today_fallback" };

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const cand = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (isValidCalendarDate(cand) && !isFuture(cand, today, 1)) return { date: cand, confidence: 0.95, source: "iso" };
  }

  const brFull = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (brFull) {
    let y = brFull[3];
    if (y.length === 2) y = (Number(y) >= 70 ? "19" : "20") + y;
    const cand = `${y}-${brFull[2].padStart(2, "0")}-${brFull[1].padStart(2, "0")}`;
    if (isValidCalendarDate(cand) && !isFuture(cand, today, 1)) return { date: cand, confidence: 0.9, source: "br_full" };
  }

  const brPartial = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (brPartial) {
    const md = `${brPartial[2].padStart(2, "0")}-${brPartial[1].padStart(2, "0")}`;
    const year = inferYearFromPeriod(md, { start: ctx.statement_period_start, end: ctx.statement_period_end });
    if (year) {
      const cand = `${year}-${md}`;
      if (isValidCalendarDate(cand) && !isFuture(cand, today, 1)) return { date: cand, confidence: 0.75, source: "period_inferred" };
    }
  }

  return { date: fallback, confidence: 0.3, source: periodEnd ? "period_end_fallback" : "today_fallback" };
}

function isFuture(iso: string, today: string, toleranceDays = 0): boolean {
  const t = new Date(`${iso}T12:00:00Z`).getTime();
  const now = new Date(`${today}T12:00:00Z`).getTime();
  return (t - now) / 86_400_000 > toleranceDays;
}
