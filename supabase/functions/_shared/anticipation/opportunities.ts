// anticipation_contract.v1 — geração de oportunidades futuras.
// Um padrão só vira comunicação quando existe uma data futura concreta, uma
// janela de ação e utilidade suficiente. Nunca gera oportunidade retroativa.

import { round2 } from "../finance-core/facts.ts";
import {
  anticipationLogicalKey,
  type AnticipationOpportunity,
  type BehavioralPattern,
  type DetectorConfig,
  type StalePolicy,
} from "./contracts.ts";
import { computeUtility, fatigueFactor, receptivityFactor } from "./utility.ts";
import { resolveOptimalSendAt } from "./sendTime.ts";

const DEFAULT_TZ = "America/Sao_Paulo";

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function monthPhaseOf(dateStr: string): "inicio" | "meio" | "fim" {
  const day = Number(dateStr.slice(8, 10));
  if (day <= 10) return "inicio";
  if (day <= 20) return "meio";
  return "fim";
}

/** Próxima data (>= amanhã) em que o padrão pode se repetir. */
export function nextOccurrenceDate(pattern: BehavioralPattern, todayIso: string): string | null {
  const horizon = 40;
  const target = pattern.pattern_key;
  for (let offset = 1; offset <= horizon; offset++) {
    const candidate = addDays(todayIso, offset);
    switch (pattern.detector) {
      case "weekday_spending_risk": {
        const wd = Number(target.split(":")[1]);
        if (weekdayOf(candidate) === wd) return candidate;
        break;
      }
      case "weekend_spending_risk": {
        if (weekdayOf(candidate) === 6) return candidate;
        break;
      }
      case "month_phase_spending_risk": {
        const phase = target.split(":")[1] as "inicio" | "meio" | "fim";
        if (monthPhaseOf(candidate) === phase && Number(candidate.slice(8, 10)) % 10 === 1) return candidate;
        break;
      }
      case "expected_recurring_payment": {
        const day = Number((pattern.evidence as { expected_day?: number }).expected_day ?? 0);
        if (day > 0 && Number(candidate.slice(8, 10)) === day) return candidate;
        break;
      }
      case "card_cycle_acceleration":
      case "upcoming_cash_pressure":
      case "small_spend_acceleration":
        return addDays(todayIso, 1);
    }
  }
  return null;
}

function copyFor(pattern: BehavioralPattern, dateStr: string): { title: string; body: string; severity: AnticipationOpportunity["severity"] } {
  const amostra = `${pattern.sample_size} ocorrências`;
  const typical = brl(pattern.pattern_value);
  const usual = brl(pattern.baseline_value);
  const diff = brl(Math.abs(pattern.absolute_delta));

  switch (pattern.detector) {
    case "weekday_spending_risk":
    case "weekend_spending_risk":
    case "month_phase_spending_risk":
      return {
        severity: "attention",
        title: pattern.label,
        body: `Nas últimas ${amostra}, esse período teve gasto ajustável perto de ${typical}, contra ${usual} nos outros dias — diferença de ${diff}. Se quiser, defina um limite para hoje antes de começar.`,
      };
    case "card_cycle_acceleration":
      return {
        severity: "attention",
        title: pattern.label,
        body: `O ritmo atual do ciclo projeta ${typical} contra ${usual} nos ${amostra} anteriores. Ainda dá tempo de ajustar antes do fechamento.`,
      };
    case "expected_recurring_payment":
      return {
        severity: "info",
        title: pattern.label,
        body: `Esse compromisso apareceu em ${amostra} e costuma ficar perto de ${typical}. Vale conferir se o saldo cobre a data.`,
      };
    case "upcoming_cash_pressure":
      return {
        severity: "critical",
        title: pattern.label,
        body: `Os compromissos previstos somam ${typical} antes da próxima entrada, e o caixa disponível está em ${usual}. Dá para reorganizar agora.`,
      };
    case "small_spend_acceleration":
    default:
      return {
        severity: "info",
        title: pattern.label,
        body: `Nas últimas semanas os gastos pequenos somaram ${typical}, contra ${usual} no seu padrão — diferença de ${diff}.`,
      };
  }
}

export type OpportunityBuildInput = {
  pattern: BehavioralPattern & { id?: string };
  config: DetectorConfig;
  todayIso: string;
  now: Date;
  timezone?: string | null;
  quietStart?: string | null;
  quietEnd?: string | null;
  habitualHour?: number | null;
  monthlyReference: number;
  fatigue: { deliveries_last_7d: number; not_useful_last_30d: number; dismissed_last_30d: number };
  receptivity: { useful_last_60d: number; deliveries_last_60d: number };
  stalePolicy: StalePolicy;
  channelTarget?: "app" | "whatsapp" | "both";
  dryRun: boolean;
};

export function buildOpportunity(input: OpportunityBuildInput): AnticipationOpportunity | null {
  const { pattern, config } = input;
  if (pattern.status !== "validated" && pattern.status !== "active") return null;

  const date = nextOccurrenceDate(pattern, input.todayIso);
  if (!date) return null;

  const windowStart = new Date(`${date}T00:00:00.000Z`);
  const windowEnd = new Date(windowStart.getTime() + config.window_hours * 3_600_000);
  const eligibleFrom = new Date(windowStart.getTime() - config.lead_time_hours * 3_600_000);
  const tz = (input.timezone ?? "").trim() || DEFAULT_TZ;

  const send = resolveOptimalSendAt({
    now: new Date(Math.max(input.now.getTime(), eligibleFrom.getTime())),
    windowStart: eligibleFrom,
    windowEnd,
    timezone: tz,
    quietStart: input.quietStart,
    quietEnd: input.quietEnd,
    habitualHour: input.habitualHour ?? null,
  });

  const hoursUntilEnd = (windowEnd.getTime() - input.now.getTime()) / 3_600_000;
  const utility = computeUtility({
    confidence: pattern.confidence,
    absolute_delta: pattern.absolute_delta,
    monthly_reference: input.monthlyReference,
    consistency: pattern.consistency,
    actionable: true,
    hours_until_window_end: hoursUntilEnd,
    receptivity: receptivityFactor(input.receptivity),
    interruption_cost: pattern.detector === "small_spend_acceleration" ? 0.4 : 0.2,
    fatigue: fatigueFactor(input.fatigue),
  });

  const copy = copyFor(pattern, date);
  const dedupKey = `anticipation:${pattern.detector}:${pattern.pattern_key}:${date}`;

  return {
    user_id: pattern.user_id,
    pattern_id: pattern.id ?? null,
    detector: pattern.detector,
    kind: config.kind,
    severity: copy.severity,
    status: "scheduled",
    opportunity_date: date,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    eligible_from: eligibleFrom.toISOString(),
    optimal_send_at: send.sendAt,
    timezone: tz,
    stale_policy: input.stalePolicy,
    expected_value: round2(pattern.pattern_value),
    baseline_value: round2(pattern.baseline_value),
    utility_score: utility.score,
    utility_breakdown: { ...utility.breakdown, min_required: config.min_utility_score },
    confidence: pattern.confidence,
    title: copy.title,
    body: copy.body,
    action: { route: "/app/antecipacoes", label: "Ver padrão" },
    evidence: {
      ...pattern.evidence,
      detector: pattern.detector,
      pattern_key: pattern.pattern_key,
      sample_size: pattern.sample_size,
      uplift_pct: pattern.uplift_pct,
      exclusions: pattern.exclusions,
      send_time_reason: send.reason,
    },
    channel_target: input.channelTarget ?? "app",
    dry_run: input.dryRun,
    dedup_key: dedupKey,
    logical_dedup_key: anticipationLogicalKey(pattern.user_id, pattern.detector, pattern.pattern_key, date),
  };
}

/** Revalidação obrigatória antes do envio: o padrão precisa continuar de pé. */
export function stillValid(
  opportunity: Pick<AnticipationOpportunity, "expected_value" | "baseline_value" | "confidence">,
  fresh: Pick<BehavioralPattern, "pattern_value" | "baseline_value" | "confidence" | "status"> | null,
  config: Pick<DetectorConfig, "min_confidence" | "min_absolute_delta">,
): boolean {
  if (!fresh) return false;
  if (fresh.status !== "validated" && fresh.status !== "active") return false;
  if (fresh.confidence < config.min_confidence) return false;
  return fresh.pattern_value - fresh.baseline_value >= config.min_absolute_delta;
}
