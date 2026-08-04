// anticipation_contract.v1 — contratos do Motor de Antecipação Comportamental.
// Nenhuma fórmula financeira nova: os fatos comportamentais derivam do núcleo
// canônico (`finance-core/facts.ts`), e nada aqui escreve em lançamentos.

export const ANTICIPATION_FORMULA_VERSION = "anticipation_contract.v1";

export type MonthPhase = "inicio" | "meio" | "fim";
export type OccurredAtPrecision = "day" | "hour" | "minute";

export type BehavioralClass =
  | "consumption_adjustable"
  | "consumption_fixed"
  | "income"
  | "excluded";

export type TransactionFact = {
  user_id: string;
  transaction_id: string;
  formula_version: string;
  local_date: string;
  local_time: string | null;
  occurred_at_precision: OccurredAtPrecision;
  weekday: number;
  week_start: string;
  month_phase: MonthPhase;
  card_cycle_id: string | null;
  card_cycle_day: number | null;
  category_id: string | null;
  category_name: string | null;
  category_confidence: number;
  merchant_normalized: string | null;
  merchant_canonical: string | null;
  movement_kind: string;
  behavioral_class: BehavioralClass;
  amount_gross: number;
  amount_net: number;
  is_consumption: boolean;
  is_adjustable: boolean;
  is_fixed: boolean;
  is_exceptional: boolean;
  is_planned: boolean;
  is_refund: boolean;
  is_transfer: boolean;
  is_card_payment: boolean;
  is_debt_principal: boolean;
  data_confidence: number;
  source_snapshot_id: string | null;
};

export type DailyFact = {
  user_id: string;
  local_date: string;
  formula_version: string;
  weekday: number;
  week_start: string;
  month_phase: MonthPhase;
  total_consumption: number;
  total_adjustable: number;
  total_fixed: number;
  total_card: number;
  total_food: number;
  total_leisure: number;
  total_small_spend: number;
  small_spend_count: number;
  entries_count: number;
  categorization_coverage: number;
  amount_uncategorized: number;
  is_payday_window: boolean;
  is_holiday: boolean;
  is_exceptional_day: boolean;
  data_confidence: number;
};

export type CycleFact = {
  user_id: string;
  cycle_kind: "week" | "month" | "card_cycle" | "payday_window";
  cycle_key: string;
  period_start: string;
  period_end: string;
  formula_version: string;
  total_consumption: number;
  total_adjustable: number;
  total_fixed: number;
  total_card: number;
  entries_count: number;
  days_covered: number;
  metrics: Record<string, number>;
  data_confidence: number;
};

export type DetectorKey =
  | "weekday_spending_risk"
  | "weekend_spending_risk"
  | "month_phase_spending_risk"
  | "card_cycle_acceleration"
  | "upcoming_cash_pressure"
  | "expected_recurring_payment"
  | "small_spend_acceleration";

export type DetectorConfig = {
  detector: DetectorKey;
  version: string;
  active: boolean;
  kind: string;
  min_sample: number;
  min_window_days: number;
  min_uplift_pct: number;
  min_absolute_delta: number;
  min_hit_rate: number;
  min_confidence: number;
  min_coverage: number;
  min_utility_score: number;
  lead_time_hours: number;
  window_hours: number;
};

export type PatternStatus =
  | "candidate"
  | "validated"
  | "active"
  | "weakened"
  | "expired"
  | "muted";

export type BehavioralPattern = {
  user_id: string;
  detector: DetectorKey;
  pattern_key: string;
  label: string;
  status: PatternStatus;
  sample_size: number;
  window_start: string | null;
  window_end: string | null;
  baseline_value: number;
  pattern_value: number;
  uplift_pct: number;
  absolute_delta: number;
  hit_rate: number;
  consistency: number;
  confidence: number;
  data_coverage: number;
  evidence: Record<string, unknown>;
  exclusions: string[];
  formula_version: string;
  detector_version: string;
};

export type StalePolicy =
  | "drop_after_window"
  | "convert_to_in_app"
  | "send_summary_later"
  | "recompute_before_send";

export type AnticipationOpportunity = {
  user_id: string;
  pattern_id: string | null;
  detector: DetectorKey;
  kind: string;
  severity: "info" | "attention" | "critical";
  status: "scheduled" | "revalidating" | "ready" | "suppressed" | "dispatched" | "expired" | "missed" | "cancelled";
  opportunity_date: string;
  window_start: string;
  window_end: string;
  eligible_from: string;
  optimal_send_at: string | null;
  timezone: string;
  stale_policy: StalePolicy;
  expected_value: number;
  baseline_value: number;
  utility_score: number;
  utility_breakdown: Record<string, number>;
  confidence: number;
  title: string;
  body: string;
  action: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
  channel_target: "app" | "whatsapp" | "both";
  dry_run: boolean;
  dedup_key: string;
  logical_dedup_key: string;
};

/** Chave lógica única do assunto antecipado (dia + padrão), independente do canal. */
export function anticipationLogicalKey(
  userId: string,
  detector: string,
  patternKey: string,
  opportunityDate: string,
): string {
  return `anticipation:${userId}:${detector}:${patternKey}:${opportunityDate}`;
}
