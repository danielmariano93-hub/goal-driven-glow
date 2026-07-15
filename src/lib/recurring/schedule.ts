/** Cálculo determinístico das próximas ocorrências de uma regra recorrente. */

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurringRule {
  frequency: Frequency;
  start_date: string; // ISO
  end_date?: string | null;
  day_of_month?: number | null; // 1..31
  weekday?: number | null; // 0..6 (0=domingo)
}

function lastDayOfMonth(year: number, monthIdx: number): number {
  // monthIdx é 0-based (JS)
  return new Date(year, monthIdx + 1, 0).getDate();
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseIso(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
}

/** Retorna as próximas N ocorrências a partir de `from` (inclusive). */
export function nextOccurrences(rule: RecurringRule, from: string, count: number): string[] {
  const out: string[] = [];
  const start = parseIso(rule.start_date);
  const end = rule.end_date ? parseIso(rule.end_date) : null;
  const fromP = parseIso(from);
  const fromKey = iso(fromP.y, fromP.m, fromP.d);

  let cursorY = start.y;
  let cursorM = start.m;
  let cursorD = start.d;

  const step = () => {
    if (rule.frequency === "daily") {
      const nd = new Date(cursorY, cursorM, cursorD + 1);
      cursorY = nd.getFullYear(); cursorM = nd.getMonth(); cursorD = nd.getDate();
    } else if (rule.frequency === "weekly") {
      const nd = new Date(cursorY, cursorM, cursorD + 7);
      cursorY = nd.getFullYear(); cursorM = nd.getMonth(); cursorD = nd.getDate();
    } else if (rule.frequency === "monthly") {
      cursorM += 1;
      if (cursorM > 11) { cursorY += 1; cursorM = 0; }
    } else {
      cursorY += 1;
    }
  };

  const compute = (): { y: number; m: number; d: number } => {
    if (rule.frequency === "monthly" && rule.day_of_month) {
      const ld = lastDayOfMonth(cursorY, cursorM);
      return { y: cursorY, m: cursorM, d: Math.min(rule.day_of_month, ld) };
    }
    if (rule.frequency === "weekly" && rule.weekday != null) {
      const base = new Date(cursorY, cursorM, cursorD);
      const diff = (rule.weekday - base.getDay() + 7) % 7;
      const nd = new Date(cursorY, cursorM, cursorD + diff);
      return { y: nd.getFullYear(), m: nd.getMonth(), d: nd.getDate() };
    }
    return { y: cursorY, m: cursorM, d: cursorD };
  };

  const guard = 500;
  for (let i = 0; i < guard && out.length < count; i++) {
    const occ = compute();
    const key = iso(occ.y, occ.m, occ.d);
    if (end) {
      const ek = iso(end.y, end.m, end.d);
      if (key > ek) break;
    }
    if (key >= fromKey) out.push(key);
    step();
  }
  return out;
}
