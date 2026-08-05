/**
 * Período compartilhado entre Home e Relatórios.
 * Persistência local (por dispositivo) para manter o filtro selecionado
 * na Home refletindo automaticamente em outras telas de análise.
 */
export type PeriodKind = "month" | "previousMonth" | "7d" | "30d" | "custom";

export interface PeriodState {
  period: PeriodKind;
  customStart: string;
  customEnd: string;
}

const KEY = "meunino.periodFilter.v1";
const LEGACY_KEYS = ["nocontrole.periodFilter.v1"];

/** Migração one-shot da chave legada para a atual (rebranding MeuNino). */
function migrateLegacyKey(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(KEY)) return;
    for (const legacy of LEGACY_KEYS) {
      const raw = window.localStorage.getItem(legacy);
      if (raw) {
        window.localStorage.setItem(KEY, raw);
        window.localStorage.removeItem(legacy);
        return;
      }
    }
  } catch {
    /* noop */
  }
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function defaultPeriod(): PeriodState {
  const now = new Date();
  return {
    period: "month",
    customStart: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    customEnd: isoDate(now),
  };
}

export function getPeriod(): PeriodState {
  if (typeof window === "undefined") return defaultPeriod();
  migrateLegacyKey();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultPeriod();
    const parsed = JSON.parse(raw) as Partial<PeriodState>;
    const base = defaultPeriod();
    return {
      period: (parsed.period as PeriodKind) ?? base.period,
      customStart: parsed.customStart ?? base.customStart,
      customEnd: parsed.customEnd ?? base.customEnd,
    };
  } catch {
    return defaultPeriod();
  }
}

export function setPeriod(state: PeriodState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* noop */
  }
}

/** Resolve início/fim (YYYY-MM-DD) a partir do estado persistido. */
export function resolvePeriodRange(state: PeriodState = getPeriod()): { start: string; end: string } {
  const now = new Date();
  const end = state.period === "custom"
    ? state.customEnd
    : state.period === "previousMonth"
      ? isoDate(new Date(now.getFullYear(), now.getMonth(), 0))
      : isoDate(now);
  const startDate = state.period === "previousMonth"
    ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
    : new Date(now);
  if (state.period === "month") startDate.setDate(1);
  if (state.period === "7d") startDate.setDate(startDate.getDate() - 6);
  if (state.period === "30d") startDate.setDate(startDate.getDate() - 29);
  const start = state.period === "custom" ? state.customStart : isoDate(startDate);
  return { start, end };
}

const LONG_MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function dateParts(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) } : null;
}

export function formatPeriodLabel(startIso: string, endIso: string): string {
  const start = dateParts(startIso);
  const end = dateParts(endIso);
  if (!start || !end) return `${startIso}–${endIso}`;
  const currentYear = new Date().getFullYear();
  const lastDay = new Date(end.year, end.month + 1, 0).getDate();
  if (start.day === 1 && end.day === lastDay && start.month === end.month && start.year === end.year) {
    return `${LONG_MONTHS[start.month][0].toUpperCase()}${LONG_MONTHS[start.month].slice(1)} de ${start.year}`;
  }
  if (start.month === end.month && start.year === end.year) {
    return `${start.day}–${end.day} de ${LONG_MONTHS[end.month]}${end.year === currentYear ? "" : ` de ${end.year}`}`;
  }
  const startYear = start.year !== end.year ? ` de ${start.year}` : "";
  const endYear = end.year === currentYear ? "" : ` de ${end.year}`;
  return `${start.day} de ${LONG_MONTHS[start.month]}${startYear}–${end.day} de ${LONG_MONTHS[end.month]}${endYear}`;
}
