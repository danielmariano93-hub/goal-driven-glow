// Helpers de período em America/Sao_Paulo. Datas em YYYY-MM-DD.
export function todaySP(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

export function monthRange(ymd: string): { from: string; to: string; daysInMonth: number } {
  const [y, m] = ymd.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const daysInMonth = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  return { from, to, daysInMonth };
}

export function shiftMonth(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function dayOfMonth(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

/** Compara dois períodos "equivalentes": mesmo tamanho em dias. */
export function comparablePeriods(periodA: { from: string; to: string }, periodB: { from: string; to: string }): boolean {
  const daysA = daysBetween(periodA.from, periodA.to);
  const daysB = daysBetween(periodB.from, periodB.to);
  return Math.abs(daysA - daysB) <= 1;
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000) + 1;
}
