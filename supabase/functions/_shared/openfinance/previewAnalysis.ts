// Resumo agregado da prévia do Open Finance: o que o banco trouxe x o que o Nino já tem.
// Só números (mês, tipo, natureza, resultado do cruzamento, contagem e soma) — nunca descrições.
import type { PreviewRow } from "../import/stage.ts";

export type BankAgg = { month: string; verdict: string; kind: string; type: string; n: number; total: number };
export type NinoAgg = { month: string; origin: string; kind: string; type: string; n: number; total: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

export function aggregateBankRows(rows: Array<Pick<PreviewRow, "verdict" | "movement_kind" | "type" | "amount" | "date">>): BankAgg[] {
  const map = new Map<string, BankAgg>();
  for (const row of rows) {
    const month = String(row.date).slice(0, 7);
    const key = `${month}|${row.verdict}|${row.movement_kind}|${row.type}`;
    const cur = map.get(key) ?? { month, verdict: row.verdict, kind: row.movement_kind, type: row.type, n: 0, total: 0 };
    cur.n += 1;
    cur.total = r2(cur.total + Number(row.amount || 0));
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month) || a.kind.localeCompare(b.kind));
}

export function aggregateNinoRows(rows: Array<{ occurred_at: string; origin: string | null; movement_kind: string | null; type: string; amount: number }>): NinoAgg[] {
  const map = new Map<string, NinoAgg>();
  for (const row of rows) {
    const month = String(row.occurred_at).slice(0, 7);
    const kind = row.movement_kind ?? "transaction";
    const origin = row.origin ?? "?";
    const key = `${month}|${origin}|${kind}|${row.type}`;
    const cur = map.get(key) ?? { month, origin, kind, type: row.type, n: 0, total: 0 };
    cur.n += 1;
    cur.total = r2(cur.total + Number(row.amount || 0));
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month) || a.kind.localeCompare(b.kind));
}
