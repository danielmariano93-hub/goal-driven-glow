import { behavioralMetricAmount, type TransactionRow } from "../engine/facts.ts";
import type { ConfidenceLevel } from "../intelligence/contracts.ts";
import { resolveBehavioralDate } from "./behavioralDate.ts";
import {
  computeWeekdayTruth,
  WEEKDAY_TRUTH_FORMULA_VERSION,
  type WeekdayTruthDecision,
  type WeekdayTruthMetric,
} from "./weekdayTruth.ts";

export type WeekdayTransaction = TransactionRow & {
  occurred_at: string;
  behavioral_day?: string | null;
  behavior_date_source?: string | null;
  behavior_date_confidence?: number | string | null;
};

export type WeekdayMetricRow = WeekdayTruthMetric;

export type WeekdayPatternResult = {
  metric_key: string;
  formula_version: string;
  period: { from: string; to: string; weeks_observed: number };
  sample_size: number;
  confidence: ConfidenceLevel;
  decision: WeekdayTruthDecision;
  provisional: boolean;
  winner: (WeekdayMetricRow & { margin_pct: number; margin_amount: number }) | null;
  candidate: (WeekdayMetricRow & { margin_pct: number; margin_amount: number }) | null;
  runner_up: WeekdayMetricRow | null;
  tied_leaders: WeekdayMetricRow[];
  total_concentration_winner: (WeekdayMetricRow & { share_pct: number }) | null;
  frequency_winner: WeekdayMetricRow | null;
  ticket_winner: WeekdayMetricRow | null;
  weekdays: WeekdayMetricRow[];
  outliers: Array<{ date: string; weekday: number; label: string; amount: number }>;
  excluded_low_confidence: number;
  data_coverage: number;
  /** Base monetária somada no período e média verdadeira por dia corrido. */
  base_amount: number;
  mean_per_day: number;
  /** Qual base de gasto alimentou a métrica: consumo total ou apenas ajustável. */
  metric_base: "total_consumption" | "adjustable";
  /** Fração da base que veio de data de postagem bancária (ressalva de precisão). */
  bank_posting_share: number;
  gates: Record<string, boolean>;
  exclusions: string[];
  limitations: string[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Compatibilidade para callers legados que ainda entram por transações.
 * O caminho principal do agente usa os fatos comportamentais compartilhados
 * (weekdayTool.ts); este wrapper mantém uma única POLÍTICA estatística.
 */
export function computeWeekdayPattern(args: {
  transactions: WeekdayTransaction[];
  to: string;
  weeks?: number;
}): WeekdayPatternResult {
  const requestedWeeks = Math.max(4, Math.min(52, Number(args.weeks ?? 12)));
  const from = addDays(args.to, -(requestedWeeks * 7) + 1);
  const resolved = args.transactions.map((t) => ({ t, date: resolveBehavioralDate(t) }));
  const excludedLowConfidence = resolved.filter(({ date }) => !date.eligibleForBehavior).length;
  const daily = new Map<string, { amount: number; transactions: number }>();

  for (const { t, date } of resolved) {
    if (!date.eligibleForBehavior || date.day < from || date.day > args.to) continue;
    const amount = behavioralMetricAmount({ ...t, amount: Number(t.amount || 0) } as TransactionRow, "expense");
    if (amount <= 0) continue;
    const cur = daily.get(date.day) ?? { amount: 0, transactions: 0 };
    cur.amount += amount;
    cur.transactions += 1;
    daily.set(date.day, cur);
  }

  const truth = computeWeekdayTruth({
    from,
    to: args.to,
    days: [...daily.entries()].map(([date, value]) => ({
      date,
      amount: round2(value.amount),
      transactions: value.transactions,
      confidence: 1,
    })),
    coverage: 1,
  });
  return toWeekdayPatternResult(truth, excludedLowConfidence);
}

export function computeWeekdayPatternFromDailyFacts(args: {
  days: Array<{
    local_date: string;
    weekday?: number;
    total_adjustable: number;
    total_consumption?: number;
    entries_count?: number;
    is_exceptional_day?: boolean;
    data_confidence?: number;
  }>;
  from: string;
  to: string;
  coverage?: number;
  /**
   * Base monetária da métrica. O padrão é o consumo total: o usuário compara a
   * resposta com o que saiu da conta, não com um subconjunto "ajustável".
   */
  metricBase?: "total_consumption" | "adjustable";
  bankPostingShare?: number;
  policy?: Parameters<typeof computeWeekdayTruth>[0]["policy"];
}): WeekdayPatternResult {
  const metricBase = args.metricBase ?? "total_consumption";
  const truth = computeWeekdayTruth({
    from: args.from,
    to: args.to,
    coverage: args.coverage,
    policy: args.policy,
    days: args.days.map((day) => ({
      date: day.local_date,
      weekday: day.weekday,
      amount: Math.max(0, Number(
        (metricBase === "total_consumption" ? day.total_consumption ?? day.total_adjustable : day.total_adjustable) ?? 0,
      )),
      transactions: Math.max(0, Number(day.entries_count ?? 0)),
      exceptional: Boolean(day.is_exceptional_day),
      confidence: Number(day.data_confidence ?? 1),
    })),
  });
  return toWeekdayPatternResult(truth, 0, metricBase, args.bankPostingShare ?? 0);
}


function toWeekdayPatternResult(
  truth: ReturnType<typeof computeWeekdayTruth>,
  excludedLowConfidence: number,
  metricBase: "total_consumption" | "adjustable" = "adjustable",
  bankPostingShare = 0,
): WeekdayPatternResult {
  const totalAll = truth.weekdays.reduce((sum, row) => sum + row.total, 0);
  const totalRow = [...truth.weekdays].filter((row) => row.total > 0).sort((a, b) => b.total - a.total)[0] ?? null;
  const frequencyWinner = [...truth.weekdays]
    .filter((row) => row.transactions > 0 && row.occurrences >= 4)
    .sort((a, b) => b.transactions_per_occurrence - a.transactions_per_occurrence)[0] ?? null;
  const ticketWinner = [...truth.weekdays]
    .filter((row) => row.transactions >= 4)
    .sort((a, b) => b.average_ticket - a.average_ticket)[0] ?? null;

  return {
    metric_key: "weekday_typical_spend",
    formula_version: WEEKDAY_TRUTH_FORMULA_VERSION,
    period: truth.period,
    sample_size: truth.sample_size,
    confidence: truth.confidence as ConfidenceLevel,
    decision: truth.decision,
    provisional: truth.decision !== "established",
    winner: truth.winner,
    candidate: truth.candidate,
    runner_up: truth.runner_up,
    tied_leaders: truth.tied_leaders,
    total_concentration_winner: totalRow
      ? { ...totalRow, share_pct: totalAll ? round2((totalRow.total / totalAll) * 100) : 0 }
      : null,
    frequency_winner: frequencyWinner,
    ticket_winner: ticketWinner,
    weekdays: truth.weekdays,
    outliers: truth.outliers,
    excluded_low_confidence: excludedLowConfidence,
    data_coverage: truth.data_coverage,
    base_amount: truth.base_amount,
    mean_per_day: truth.mean_per_day,
    metric_base: metricBase,
    bank_posting_share: round2(Math.max(0, Math.min(1, Number(bankPostingShare) || 0))),
    gates: truth.gates,
    exclusions: [
      "transferências internas",
      "aplicações, resgates e rendimentos",
      "pagamento de fatura",
      "movimentos planejados ou cancelados",
      "dias extraordinários separados do comportamento típico",
      ...(metricBase === "adjustable"
        ? ["gastos fixos fora da métrica de gasto ajustável"]
        : []),
    ],
    limitations: truth.limitations,
  };
}
