import { behavioralMetricAmount, type TransactionRow } from "../engine/facts.ts";
import type { ConfidenceLevel } from "../intelligence/contracts.ts";

export type WeekdayTransaction = TransactionRow & { occurred_at: string };

export type WeekdayMetricRow = {
  weekday: number;
  label: string;
  occurrences: number;
  active_days: number;
  transactions: number;
  total: number;
  mean_all_days: number;
  median_all_days: number;
  typical_amount: number;
  outlier_count: number;
  transactions_per_occurrence: number;
  average_ticket: number;
};

export type WeekdayPatternResult = {
  metric_key: string;
  formula_version: string;
  period: { from: string; to: string; weeks_observed: number };
  sample_size: number;
  confidence: ConfidenceLevel;
  winner: (WeekdayMetricRow & { margin_pct: number }) | null;
  total_concentration_winner: (WeekdayMetricRow & { share_pct: number }) | null;
  frequency_winner: WeekdayMetricRow | null;
  ticket_winner: WeekdayMetricRow | null;
  weekdays: WeekdayMetricRow[];
  outliers: Array<{ date: string; weekday: number; label: string; amount: number }>;
  exclusions: string[];
  limitations: string[];
};

const LABELS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
function dow(iso: string): number { return new Date(`${iso}T12:00:00Z`).getUTCDay(); }
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
function highOutlierThreshold(values: number[]): number {
  if (values.length < 4) return Number.POSITIVE_INFINITY;
  const med = median(values);
  const mad = median(values.map(v => Math.abs(v - med)));
  if (mad > 0) return med + 3 * 1.4826 * mad;
  const q1 = quantile(values, 0.25), q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  if (iqr > 0) return q3 + 1.5 * iqr;
  const max = Math.max(...values);
  // Repeated baseline + one isolated peak makes both MAD and IQR equal zero.
  // In that shape, use a conservative absolute/relative guard instead of
  // silently treating the peak as the user's normal behaviour.
  if (max - med >= 100 && max > Math.max(100, med * 3)) {
    return med + Math.max(100, med * 2);
  }
  return Number.POSITIVE_INFINITY;
}

export function computeWeekdayPattern(args: {
  transactions: WeekdayTransaction[];
  to: string;
  weeks?: number;
}): WeekdayPatternResult {
  const requestedWeeks = Math.max(4, Math.min(52, Number(args.weeks ?? 12)));
  const requestedFrom = addDays(args.to, -(requestedWeeks * 7) + 1);
  const valid = args.transactions
    .map(t => ({ ...t, amount: Number(t.amount || 0) }))
    .filter(t => t.occurred_at >= requestedFrom && t.occurred_at <= args.to)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  const first = valid[0]?.occurred_at ?? requestedFrom;
  const from = first > requestedFrom ? first : requestedFrom;
  const daily = new Map<string, { amount: number; transactions: number }>();
  for (const t of valid) {
    const amount = behavioralMetricAmount(t as TransactionRow, "expense");
    if (amount === 0) continue;
    const cur = daily.get(t.occurred_at) ?? { amount: 0, transactions: 0 };
    cur.amount += amount;
    if (amount > 0) cur.transactions += 1;
    daily.set(t.occurred_at, cur);
  }

  const allDates: string[] = [];
  for (let d = from; d <= args.to; d = addDays(d, 1)) allDates.push(d);
  const buckets = Array.from({ length: 7 }, () => [] as Array<{ date: string; amount: number; transactions: number }>);
  for (const date of allDates) {
    const v = daily.get(date) ?? { amount: 0, transactions: 0 };
    buckets[dow(date)].push({ date, amount: round2(Math.max(0, v.amount)), transactions: v.transactions });
  }

  const outliers: WeekdayPatternResult["outliers"] = [];
  const weekdays: WeekdayMetricRow[] = buckets.map((days, weekday) => {
    const values = days.map(d => d.amount);
    const threshold = highOutlierThreshold(values);
    const clean = days.filter(d => d.amount <= threshold);
    const flagged = days.filter(d => d.amount > threshold);
    for (const f of flagged) outliers.push({ date: f.date, weekday, label: LABELS[weekday], amount: f.amount });
    const total = values.reduce((s, v) => s + v, 0);
    const txCount = days.reduce((s, d) => s + d.transactions, 0);
    return {
      weekday,
      label: LABELS[weekday],
      occurrences: days.length,
      active_days: days.filter(d => d.amount > 0).length,
      transactions: txCount,
      total: round2(total),
      mean_all_days: round2(days.length ? total / days.length : 0),
      median_all_days: round2(median(values)),
      typical_amount: round2(median(clean.map(d => d.amount))),
      outlier_count: flagged.length,
      transactions_per_occurrence: round2(days.length ? txCount / days.length : 0),
      average_ticket: round2(txCount ? total / txCount : 0),
    };
  });

  const eligible = weekdays.filter(w => w.occurrences >= 4);
  const typicalRank = [...eligible].sort((a, b) => b.typical_amount - a.typical_amount);
  const totalRank = [...eligible].sort((a, b) => b.total - a.total);
  const freqRank = [...eligible].sort((a, b) => b.transactions_per_occurrence - a.transactions_per_occurrence);
  const ticketRank = [...eligible].filter(w => w.transactions > 0).sort((a, b) => b.average_ticket - a.average_ticket);
  const top = typicalRank[0] ?? null;
  const second = typicalRank[1] ?? null;
  const margin = top && second && second.typical_amount > 0
    ? (top.typical_amount - second.typical_amount) / second.typical_amount
    : top?.typical_amount ? 1 : 0;
  const activeDays = weekdays.reduce((s, w) => s + w.active_days, 0);
  const completeness = allDates.length ? activeDays / allDates.length : 0;
  const weeksObserved = Math.max(0, allDates.length / 7);

  let confidence: ConfidenceLevel = "insufficient";
  if (top && weeksObserved >= 4 && activeDays >= 10) {
    confidence = weeksObserved >= 12 && completeness >= 0.55 && margin >= 0.2
      ? "high"
      : weeksObserved >= 8 && completeness >= 0.3 && margin >= 0.1
        ? "medium"
        : "low";
  }

  const totalAll = weekdays.reduce((s, w) => s + w.total, 0);
  const totalWinner = totalRank[0]
    ? { ...totalRank[0], share_pct: totalAll ? round2(totalRank[0].total / totalAll * 100) : 0 }
    : null;
  const limitations: string[] = [];
  if (weeksObserved < 8) limitations.push("O histórico ainda é curto; esse padrão pode mudar com novas semanas.");
  if (completeness < 0.3) limitations.push("Há poucos dias com movimentações registradas, então a confiança é reduzida.");
  if (margin < 0.1 && top) limitations.push("Os dois dias líderes estão muito próximos; não há um vencedor claro.");

  return {
    metric_key: "weekday_typical_spend",
    formula_version: "weekday.robust.v1",
    period: { from, to: args.to, weeks_observed: round2(weeksObserved) },
    sample_size: activeDays,
    confidence,
    winner: top ? { ...top, margin_pct: round2(margin * 100) } : null,
    total_concentration_winner: totalWinner,
    frequency_winner: freqRank[0] ?? null,
    ticket_winner: ticketRank[0] ?? null,
    weekdays,
    outliers,
    exclusions: [
      "transferências internas",
      "aplicações, resgates e rendimentos",
      "pagamento de fatura",
      "movimentos planejados ou cancelados",
      "picos altos separados da métrica de comportamento típico",
    ],
    limitations,
  };
}
