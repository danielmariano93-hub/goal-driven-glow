// deno-lint-ignore-file no-explicit-any
// proactive_multifinance.v1 — horizonte de caixa (função pura, sem I/O).
import type { CashHorizonPoint } from "./contracts.ts";

const HORIZON_DAYS = 30;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Horizonte de caixa: saldo de hoje + entradas previstas − compromissos conhecidos. */
export function buildCashHorizon(input: {
  today: string;
  availableToday: number;
  incomeEvents: Array<{ date: string; amount: number; label?: string }>;
  commitments: Array<{ date: string; amount: number; type: string; name?: string }>;
  horizonDays?: number;
}): CashHorizonPoint[] {
  const horizonDays = input.horizonDays ?? HORIZON_DAYS;
  const limit = addDays(input.today, horizonDays);
  const byDate = new Map<string, CashHorizonPoint>();
  const ensure = (date: string): CashHorizonPoint => {
    if (!byDate.has(date)) byDate.set(date, { date, balance: 0, inflow: 0, outflow: 0, labels: [] });
    return byDate.get(date)!;
  };
  for (const event of input.incomeEvents) {
    const date = String(event.date).slice(0, 10);
    if (date < input.today || date > limit) continue;
    const point = ensure(date);
    point.inflow = round2(point.inflow + Math.abs(num(event.amount)));
    if (event.label) point.labels.push(String(event.label));
  }
  for (const item of input.commitments) {
    const date = String(item.date).slice(0, 10);
    if (date < input.today || date > limit) continue;
    const point = ensure(date);
    const amount = Math.abs(num(item.amount));
    if (item.type === "income") {
      point.inflow = round2(point.inflow + amount);
    } else {
      point.outflow = round2(point.outflow + amount);
    }
    if (item.name) point.labels.push(String(item.name));
  }
  let balance = round2(num(input.availableToday));
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((point) => {
      balance = round2(balance + point.inflow - point.outflow);
      return { ...point, balance };
    });
}

