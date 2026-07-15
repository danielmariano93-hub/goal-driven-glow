/** Cálculo determinístico das próximas ocorrências de uma regra recorrente. Timezone America/Sao_Paulo. */

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurringRule {
  frequency: Frequency;
  start_date: string; // ISO
  end_date?: string | null;
  day_of_month?: number | null; // 1..31
  weekday?: number | null; // 0..6 (0=domingo)
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Retorna as próximas N ocorrências a partir de `from` (inclusive). */
export function nextOccurrences(rule: RecurringRule, from: string, count: number): string[] {
  const out: string[] = [];
  const start = new Date(rule.start_date + "T12:00:00");
  const end = rule.end_date ? new Date(rule.end_date + "T12:00:00") : null;
  const fromD = new Date(from + "T12:00:00");
  let cur = new Date(start);
  // Fast-forward para from
  if (cur < fromD) {
    if (rule.frequency === "daily") cur = new Date(fromD);
    else if (rule.frequency === "weekly") {
      while (cur < fromD) cur.setDate(cur.getDate() + 7);
    } else if (rule.frequency === "monthly") {
      while (cur < fromD) cur.setMonth(cur.getMonth() + 1);
    } else {
      while (cur < fromD) cur.setFullYear(cur.getFullYear() + 1);
    }
  }
  while (out.length < count) {
    let occ: Date;
    if (rule.frequency === "monthly" && rule.day_of_month) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const dim = lastDayOfMonth(y, m + 1);
      occ = new Date(y, m, Math.min(rule.day_of_month, dim), 12);
    } else if (rule.frequency === "weekly" && rule.weekday != null) {
      const diff = (rule.weekday - cur.getDay() + 7) % 7;
      occ = new Date(cur);
      occ.setDate(cur.getDate() + diff);
    } else {
      occ = new Date(cur);
    }
    if (end && occ > end) break;
    if (occ >= fromD) out.push(iso(occ));
    // avança
    if (rule.frequency === "daily") cur.setDate(cur.getDate() + 1);
    else if (rule.frequency === "weekly") cur.setDate(cur.getDate() + 7);
    else if (rule.frequency === "monthly") cur.setMonth(cur.getMonth() + 1);
    else cur.setFullYear(cur.getFullYear() + 1);
  }
  return out;
}
