// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Data civil (`civil_date.v1`).
//
// Causa-raiz que este módulo fecha: vencimentos são datas civis
// (`YYYY-MM-DD`), não instantes. O código antigo montava `new Date(ano, mês,
// dia)` — meia-noite do fuso do runtime — e depois formatava em
// America/Sao_Paulo. Em produção (runtime UTC) o dia 04/09 virava 03/09.
//
// Regra: nenhuma função aqui cria `Date` a partir de componentes locais nem
// usa `toLocaleString`. Tudo é aritmética de string/inteiro, portanto o
// resultado é idêntico em qualquer timezone de runtime.

export const CIVIL_DATE_VERSION = "civil_date.v1";

export interface CivilDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Último dia do mês (ano/mês 1-based), sem depender de timezone. */
export function lastDayOfCivilMonth(year: number, month: number): number {
  const m = ((month - 1) % 12 + 12) % 12 + 1;
  const y = year + Math.floor((month - 1) / 12);
  if (m === 2) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

export function parseCivilDate(iso: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function formatCivilDate(d: CivilDate): string {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

/**
 * Data civil de vencimento: `dueDay` no mês informado, com clamp de fim de mês
 * (31 em fevereiro → 28/29; 31 em abril → 30).
 */
export function civilDueDate(year: number, month: number, dueDay: number | null | undefined): string {
  const normalizedMonth = ((month - 1) % 12 + 12) % 12 + 1;
  const normalizedYear = year + Math.floor((month - 1) / 12);
  const last = lastDayOfCivilMonth(normalizedYear, normalizedMonth);
  const day = Math.max(1, Math.min(last, Number(dueDay) || 1));
  return `${normalizedYear}-${pad2(normalizedMonth)}-${pad2(day)}`;
}

/** Vencimento no mês da data de referência (`refIso` só define ano/mês). */
export function civilDueDateInMonthOf(refIso: string, dueDay: number | null | undefined, fallbackDay = 10): string | null {
  const ref = parseCivilDate(refIso);
  if (!ref) return null;
  return civilDueDate(ref.year, ref.month, Number(dueDay) || fallbackDay);
}

/** Vencimento de uma competência `YYYY-MM`. */
export function civilDueDateForCompetence(competenceMonth: string, dueDay: number | null | undefined, fallbackDay = 10): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(competenceMonth ?? "").trim());
  if (!m) return null;
  return civilDueDate(Number(m[1]), Number(m[2]), Number(dueDay) || fallbackDay);
}

/** Soma meses preservando o dia com clamp de fim de mês. */
export function civilAddMonths(iso: string, months: number): string {
  const d = parseCivilDate(iso);
  if (!d) return String(iso).slice(0, 10);
  const zero = d.month - 1 + months;
  const year = d.year + Math.floor(zero / 12);
  const month = ((zero % 12) + 12) % 12 + 1;
  const last = lastDayOfCivilMonth(year, month);
  return `${year}-${pad2(month)}-${pad2(Math.min(d.day, last))}`;
}

/** Soma dias em data civil (usa UTC ao meio-dia: imune a DST e a fuso). */
export function civilAddDays(iso: string, days: number): string {
  const d = parseCivilDate(iso);
  if (!d) return String(iso).slice(0, 10);
  const base = Date.UTC(d.year, d.month - 1, d.day, 12, 0, 0);
  const next = new Date(base + days * 86400000);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** Diferença em dias entre duas datas civis (b - a). */
export function civilDaysBetween(aIso: string, bIso: string): number {
  const a = parseCivilDate(aIso);
  const b = parseCivilDate(bIso);
  if (!a || !b) return 0;
  const av = Date.UTC(a.year, a.month - 1, a.day, 12, 0, 0);
  const bv = Date.UTC(b.year, b.month - 1, b.day, 12, 0, 0);
  return Math.round((bv - av) / 86400000);
}
