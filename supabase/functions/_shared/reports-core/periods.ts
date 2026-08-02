// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v3)
// Janelas de período dos relatórios. Puro e determinístico.
import type { ReportPeriod, ReportType } from "./types.ts";

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function utcOf(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

const SHORT = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Semana fechada (segunda a domingo) imediatamente anterior à referência. */
export function lastClosedWeek(reference: Date): ReportPeriod {
  const ref = utcOf(reference);
  // dow: 0=dom … 1=seg
  const dow = ref.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  const thisMonday = addDays(ref, -daysSinceMonday);
  const start = addDays(thisMonday, -7);
  const end = addDays(start, 6);
  return { start: iso(start), end: iso(end), label: `${SHORT(iso(start))} a ${SHORT(iso(end))}` };
}

/** Mês fechado imediatamente anterior à referência. */
export function lastClosedMonth(reference: Date): ReportPeriod {
  const ref = utcOf(reference);
  const firstOfThis = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const end = addDays(firstOfThis, -1);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return {
    start: iso(start),
    end: iso(end),
    label: `${MONTH_NAMES[start.getUTCMonth()]} de ${start.getUTCFullYear()}`,
  };
}

/** Período imediatamente anterior, de mesma duração/natureza. */
export function previousOf(period: ReportPeriod, type: ReportType): ReportPeriod {
  const start = new Date(`${period.start}T00:00:00Z`);
  if (type === "weekly") {
    const prevStart = addDays(start, -7);
    const prevEnd = addDays(prevStart, 6);
    return { start: iso(prevStart), end: iso(prevEnd), label: `${SHORT(iso(prevStart))} a ${SHORT(iso(prevEnd))}` };
  }
  const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const prevEnd = addDays(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)), -1);
  return {
    start: iso(prevStart),
    end: iso(prevEnd),
    label: `${MONTH_NAMES[prevStart.getUTCMonth()]} de ${prevStart.getUTCFullYear()}`,
  };
}

export function resolvePeriods(type: ReportType, reference: Date): { period: ReportPeriod; previous: ReportPeriod } {
  const period = type === "weekly" ? lastClosedWeek(reference) : lastClosedMonth(reference);
  return { period, previous: previousOf(period, type) };
}

export function eachDay(period: ReportPeriod): string[] {
  const out: string[] = [];
  let cur = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    out.push(iso(cur));
    cur = addDays(cur, 1);
  }
  return out;
}

export function shortDay(dateIso: string): string {
  return SHORT(dateIso);
}

export function daysInPeriod(period: ReportPeriod): number {
  return eachDay(period).length;
}
