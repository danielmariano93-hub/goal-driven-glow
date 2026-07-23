/**
 * Período compartilhado entre Home e Relatórios.
 * Persistência local (por dispositivo) para manter o filtro selecionado
 * na Home refletindo automaticamente em outras telas de análise.
 */
export type PeriodKind = "month" | "30d" | "90d" | "custom";

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
  const end = state.period === "custom" ? state.customEnd : isoDate(new Date());
  const startDate = new Date();
  if (state.period === "month") startDate.setDate(1);
  if (state.period === "30d") startDate.setDate(startDate.getDate() - 29);
  if (state.period === "90d") startDate.setDate(startDate.getDate() - 89);
  const start = state.period === "custom" ? state.customStart : isoDate(startDate);
  return { start, end };
}
