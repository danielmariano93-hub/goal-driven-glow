// Gráfico "semana a semana": consumo (por data da compra) em blocos de 7 dias do mês, contra os mesmos dias
// do mês anterior. Os blocos somam exatamente o acumulado do mês mostrado no resumo.
import { monthBlocks, monthName, shiftMonth, daysInMonth } from "./format.ts";
import type { WeekBars } from "./types.ts";
import type { SummaryRow } from "./weekly.ts";

const cents = (rows: SummaryRow[]) => rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);

export function buildWeekBars(rows: SummaryRow[], ym: string, cutoff: string, hasPrevious: boolean): WeekBars {
  const prevYm = shiftMonth(ym, -1);
  const cutDay = cutoff.slice(0, 7) > ym ? daysInMonth(ym) : Number(cutoff.slice(8, 10));
  const inRange = (r: SummaryRow, m: string, a: number, b: number) => r.day.slice(0, 7) === m && Number(r.day.slice(8, 10)) >= a && Number(r.day.slice(8, 10)) <= b;
  const bars = monthBlocks(ym).map((b) => {
    const started = b.from <= cutDay;
    const cur = started ? cents(rows.filter((r) => inRange(r, ym, b.from, Math.min(b.to, cutDay)))) : null;
    const prevTo = Math.min(b.to, daysInMonth(prevYm));
    const prev = hasPrevious && b.from <= daysInMonth(prevYm) ? cents(rows.filter((r) => inRange(r, prevYm, b.from, prevTo))) : hasPrevious ? 0 : null;
    return { label: b.label, current_cents: cur, previous_cents: prev, partial: started && b.to > cutDay };
  });
  const totalCur = bars.reduce((s, b) => s + (b.current_cents ?? 0), 0);
  const totalPrevSameDays = hasPrevious ? cents(rows.filter((r) => inRange(r, prevYm, 1, Math.min(cutDay, daysInMonth(prevYm))))) : null;
  return {
    title: "Semana a semana",
    current_label: monthName(ym).replace(/^./, (c) => c.toUpperCase()),
    previous_label: monthName(prevYm).replace(/^./, (c) => c.toUpperCase()),
    bars,
    note: "Gasto por data da compra, em blocos de 7 dias do mês.",
    total_current_cents: totalCur,
    total_previous_cents: totalPrevSameDays,
  };
}
