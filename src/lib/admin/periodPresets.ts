/**
 * Presets de período do Admin em America/Sao_Paulo.
 * Todas as datas são retornadas em YYYY-MM-DD (SP), semi-abertas [from, to+1) no backend.
 */

export type PeriodPresetKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "current_month"
  | "previous_month"
  | "custom";

export type PeriodRange = { from: string; to: string };

export const PRESET_LABELS: Record<PeriodPresetKey, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  current_month: "Mês atual",
  previous_month: "Mês anterior",
  custom: "Personalizado",
};

/** Data atual em America/Sao_Paulo, formatada YYYY-MM-DD. */
export function todaySP(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function firstDayOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function lastDayOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ymd.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function resolvePreset(
  preset: PeriodPresetKey,
  custom?: PeriodRange,
  now: Date = new Date(),
): PeriodRange {
  const today = todaySP(now);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "current_month":
      return { from: firstDayOfMonth(today), to: today };
    case "previous_month": {
      const prevMonthAny = addDays(firstDayOfMonth(today), -1);
      return { from: firstDayOfMonth(prevMonthAny), to: lastDayOfMonth(prevMonthAny) };
    }
    case "custom":
      return custom ?? { from: today, to: today };
  }
}

/** Rótulo humano de um intervalo. */
export function formatPeriodLabel(range: PeriodRange): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  };
  return range.from === range.to ? fmt(range.from) : `${fmt(range.from)} — ${fmt(range.to)}`;
}
