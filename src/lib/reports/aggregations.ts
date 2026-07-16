export interface ReportTxn {
  type: "income" | "expense" | "transfer";
  amount: number;
  occurred_at: string; // YYYY-MM-DD
  category_id?: string | null;
  category_name?: string | null;
}

export interface MonthlyBucket {
  ym: string; // YYYY-MM
  income: number;
  expense: number;
  net: number;
}

export function groupByMonth(txns: ReportTxn[]): MonthlyBucket[] {
  const map = new Map<string, MonthlyBucket>();
  for (const t of txns) {
    if (t.type === "transfer") continue;
    const ym = t.occurred_at.slice(0, 7);
    const b = map.get(ym) ?? { ym, income: 0, expense: 0, net: 0 };
    if (t.type === "income") b.income += t.amount;
    else b.expense += t.amount;
    b.net = b.income - b.expense;
    map.set(ym, b);
  }
  return [...map.values()].sort((a, b) => a.ym.localeCompare(b.ym));
}

export function byCategory(txns: ReportTxn[]): { category: string; total: number; count: number }[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const t of txns) {
    if (t.type !== "expense") continue;
    const k = t.category_name || "Sem categoria";
    const cur = map.get(k) ?? { total: 0, count: 0 };
    cur.total += t.amount;
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.total - a.total);
}

export function filterPeriod(txns: ReportTxn[], from?: string, to?: string): ReportTxn[] {
  return txns.filter((t) => {
    if (from && t.occurred_at < from) return false;
    if (to && t.occurred_at > to) return false;
    return true;
  });
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(";"), ...rows.map((r) => headers.map((h) => escape(r[h])).join(";"))].join("\n");
}
