// nino_behavioral_timing.v1 — camada determinística de MOMENTO.
// ===========================================================================
// Pergunta que este módulo responde: "ESTE é o melhor momento para intervir?".
// Nada aqui calcula dinheiro (os valores chegam prontos do motor canônico) e
// nenhuma LLM decide timing. O resultado é auditável: score, janela, princípios
// candidatos, elegibilidade, adiamento e razão.
import type { BehavioralPrincipleKey } from "../agent/behavioralPrinciples.ts";

export const BEHAVIORAL_TIMING_VERSION = "nino_behavioral_timing.v1";

export type BehavioralTrigger =
  | "MONEY_IN"
  | "LARGE_SPEND"
  | "FLEXIBLE_SPEND_CLUSTER"
  | "CREDIT_CARD_CLOSE"
  | "CREDIT_CARD_DUE_SOON"
  | "DEBT_INSTALLMENT_DUE"
  | "GOAL_OPPORTUNITY"
  | "CASH_RECOVERY"
  | "CASH_RISK"
  | "BEHAVIOR_BREAKTHROUGH"
  | "BEHAVIOR_RELAPSE"
  | "COMMITMENT_WINDOW"
  | "PERIOD_TRANSITION";

/** Natureza da entrada de dinheiro — reaproveita `movement_kind` canônico. */
export type MoneyInKind =
  | "SALARY"
  | "RECURRING_INCOME"
  | "OTHER_INCOME"
  | "TRANSFER_IN"
  | "INVESTMENT_REDEMPTION"
  | "REFUND";

/**
 * Renda real (habilita crescimento). Transferência entre contas próprias,
 * estorno e resgate patrimonial NUNCA entram: movem caixa, não criam renda.
 */
export const INCOME_MONEY_IN_KINDS: ReadonlySet<MoneyInKind> = new Set<MoneyInKind>([
  "SALARY",
  "RECURRING_INCOME",
  "OTHER_INCOME",
]);


const SALARY_HINT = /(sal[áa]rio|proventos|folha|pagamento mensal|pro ?labore|remunera)/i;

/**
 * Classifica uma entrada usando exclusivamente campos canônicos do ledger.
 * `movement_kind` manda: transferência entre contas, resgate e estorno NUNCA
 * viram renda nova, independentemente da descrição.
 */
export function classifyMoneyIn(row: {
  type?: string | null;
  movement_kind?: string | null;
  transfer_group_id?: string | null;
  description?: string | null;
  origin?: string | null;
  recurring_rule_id?: string | null;
  recurring_entry_id?: string | null;
}): MoneyInKind {
  const kind = String(row.movement_kind ?? "transaction");
  if (kind === "refund") return "REFUND";
  if (kind === "investment_redemption" || kind === "investment_yield") return "INVESTMENT_REDEMPTION";
  if (kind === "internal_transfer" || kind === "external_transfer_in" || row.transfer_group_id) return "TRANSFER_IN";
  if (kind !== "transaction") return "TRANSFER_IN";
  if (SALARY_HINT.test(String(row.description ?? ""))) return "SALARY";
  if (row.recurring_rule_id || row.recurring_entry_id || String(row.origin ?? "") === "recurring") {
    return "RECURRING_INCOME";
  }
  return "OTHER_INCOME";
}


export type TimingWindowConfig = {
  event_type: BehavioralTrigger;
  open_after_hours: number;
  valid_for_hours: number;
  min_evidence_count: number;
  /** Piso relativo à renda mensal (0.03 = 3%). */
  relative_floor_pct: number;
  enabled: boolean;
};

/** Defaults espelhados de `nino_behavioral_timing_windows` (fallback offline). */
export const DEFAULT_TIMING_WINDOWS: Record<BehavioralTrigger, TimingWindowConfig> = {
  MONEY_IN: w("MONEY_IN", 0, 36, 1, 0.03),
  LARGE_SPEND: w("LARGE_SPEND", 0, 48, 1, 0.05),
  FLEXIBLE_SPEND_CLUSTER: w("FLEXIBLE_SPEND_CLUSTER", 0, 72, 5, 0.05),
  CREDIT_CARD_CLOSE: w("CREDIT_CARD_CLOSE", 0, 72, 1, 0.05),
  CREDIT_CARD_DUE_SOON: w("CREDIT_CARD_DUE_SOON", 0, 120, 1, 0.03),
  DEBT_INSTALLMENT_DUE: w("DEBT_INSTALLMENT_DUE", 0, 120, 1, 0.03),
  GOAL_OPPORTUNITY: w("GOAL_OPPORTUNITY", 0, 72, 1, 0.03),
  CASH_RECOVERY: w("CASH_RECOVERY", 0, 72, 1, 0.03),
  CASH_RISK: w("CASH_RISK", 0, 96, 1, 0.02),
  BEHAVIOR_BREAKTHROUGH: w("BEHAVIOR_BREAKTHROUGH", 0, 168, 3, 0),
  BEHAVIOR_RELAPSE: w("BEHAVIOR_RELAPSE", 0, 120, 2, 0.03),
  COMMITMENT_WINDOW: w("COMMITMENT_WINDOW", 0, 48, 1, 0),
  PERIOD_TRANSITION: w("PERIOD_TRANSITION", 0, 48, 5, 0),
};

function w(
  event_type: BehavioralTrigger,
  open_after_hours: number,
  valid_for_hours: number,
  min_evidence_count: number,
  relative_floor_pct: number,
): TimingWindowConfig {
  return { event_type, open_after_hours, valid_for_hours, min_evidence_count, relative_floor_pct, enabled: true };
}

export type BehavioralEventInput = {
  trigger: BehavioralTrigger;
  /**
   * Momento do EVENTO comportamental (nunca posting/competência). Compra de
   * sábado postada segunda pertence a sábado.
   */
  occurred_at: string;
  economic_event_id?: string | null;
  /** Impacto material absoluto em R$ (já determinístico). */
  materiality?: number;
  /** Quantas ocorrências sustentam o evento (repetição, amostra). */
  evidence_count?: number;
  money_in_kind?: MoneyInKind | null;
  /** Existe ação executável agora? Quando ausente, é inferido. */
  actionable?: boolean | null;
  payload?: Record<string, unknown>;
};

export type TimingContext = {
  now: string;
  monthly_income: number;
  materiality_floor: number;
  truth_gate_safe: boolean;
  projected_month_end_available: number;
  available_today: number;
  sustainable_capacity: number;
  has_active_goal: boolean;
  debt_pressure_dominant: boolean;
  commitment_pending: boolean;
  /** Taxa histórica de ação por `trigger:window` (0..1). */
  learned?: Record<string, number>;
  /** Dispensas recentes desta pessoa para o mesmo gatilho. */
  recent_dismissals?: number;
  /** Quantas vezes este mesmo evento econômico já gerou intervenção. */
  repetitions?: number;
};

export type TimingWindowBucket = "pending_open" | "immediate" | "same_day" | "late" | "closed";

export type TimingAssessment = {
  version: string;
  trigger: BehavioralTrigger;
  window: TimingWindowBucket;
  window_label: string;
  timing_score: number;
  urgency: "none" | "low" | "medium" | "high";
  principle_candidates: BehavioralPrincipleKey[];
  eligible_now: boolean;
  defer_until: string | null;
  reason: string;
  growth_blocked: boolean;
  evidence: Record<string, unknown>;
};

const HOUR = 3_600_000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** Bloqueio de crescimento: margem de segurança vence pay_yourself_first. */
export function growthBlockedBy(ctx: TimingContext): string | null {
  if (!ctx.truth_gate_safe) return "truth_gate_unsafe";
  if (ctx.projected_month_end_available < 0) return "projected_cash_negative";
  if (ctx.sustainable_capacity <= 0) return "no_sustainable_capacity";
  if (ctx.debt_pressure_dominant) return "debt_pressure_dominant";
  return null;
}

/**
 * Princípios candidatos por gatilho — matriz produtizada.
 * Ordem = preferência; `resolveBehavioralIntervention` faz a escolha final
 * considerando o aprendizado do usuário.
 */
export function principlesForTrigger(
  trigger: BehavioralTrigger,
  ctx: TimingContext,
  event?: BehavioralEventInput,
): BehavioralPrincipleKey[] {
  const blocked = growthBlockedBy(ctx) !== null;
  switch (trigger) {
    case "MONEY_IN": {
      const kind = event?.money_in_kind ?? "OTHER_INCOME";
      if (!INCOME_MONEY_IN_KINDS.has(kind)) return [];
      if (blocked) return ["margin_of_safety"];
      const out: BehavioralPrincipleKey[] = [];
      if (ctx.commitment_pending) out.push("friction_and_nudge");
      if (ctx.has_active_goal || ctx.sustainable_capacity > 0) out.push("pay_yourself_first");
      out.push("long_term_consistency");
      return out;
    }
    case "GOAL_OPPORTUNITY":
      return blocked ? ["margin_of_safety"] : ["pay_yourself_first", "opportunity_cost"];
    case "LARGE_SPEND":
      return ["opportunity_cost", "intentional_spending"];
    case "FLEXIBLE_SPEND_CLUSTER":
      return ["intentional_spending", "opportunity_cost"];
    case "CREDIT_CARD_CLOSE":
      return ["margin_of_safety", "intentional_spending"];
    case "CREDIT_CARD_DUE_SOON":
      return ["margin_of_safety"];
    case "DEBT_INSTALLMENT_DUE":
      return ["reduce_financial_pressure", "margin_of_safety"];
    case "CASH_RISK":
      return ["margin_of_safety"];
    case "CASH_RECOVERY":
      return ["long_term_consistency", "identity_reinforcement"];
    case "BEHAVIOR_BREAKTHROUGH":
      return ["identity_reinforcement", "long_term_consistency"];
    case "BEHAVIOR_RELAPSE":
      return ["intentional_spending", "friction_and_nudge"];
    case "COMMITMENT_WINDOW":
      return ["friction_and_nudge", "long_term_consistency"];
    case "PERIOD_TRANSITION":
      return ["long_term_consistency", "protect_progress"];
    default:
      return ["protect_progress"];
  }
}

function windowBucket(hoursSinceEvent: number, cfg: TimingWindowConfig): TimingWindowBucket {
  if (hoursSinceEvent < cfg.open_after_hours) return "pending_open";
  if (hoursSinceEvent > cfg.valid_for_hours) return "closed";
  if (hoursSinceEvent <= 6) return "immediate";
  if (hoursSinceEvent <= 24) return "same_day";
  return "late";
}

const WINDOW_POSITION: Record<TimingWindowBucket, number> = {
  immediate: 1,
  same_day: 0.8,
  late: 0.45,
  pending_open: 0.2,
  closed: 0,
};

function urgencyFor(score: number): TimingAssessment["urgency"] {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  if (score >= 25) return "low";
  return "none";
}

/**
 * Fórmula determinística do `timing_score` (0..100):
 *
 *   40 * window_position       — dentro da janela e antes do ponto de decisão
 * + 25 * actionability         — existe ação executável agora
 * + 20 * evidence_sufficiency  — amostra mínima do gatilho atendida
 * + 15 * learned_window_fit    — taxa histórica de ação em trigger×janela
 * - penalidades                — retrospectivo sem ação, repetição, dispensa
 */
export function assessTiming(
  event: BehavioralEventInput,
  ctx: TimingContext,
  windows: Partial<Record<BehavioralTrigger, TimingWindowConfig>> = {},
): TimingAssessment {
  const cfg = windows[event.trigger] ?? DEFAULT_TIMING_WINDOWS[event.trigger];
  const nowMs = Date.parse(ctx.now);
  const eventMs = Date.parse(event.occurred_at);
  const hoursSinceEvent = Number.isFinite(eventMs) && Number.isFinite(nowMs)
    ? (nowMs - eventMs) / HOUR
    : 0;
  const bucket = windowBucket(hoursSinceEvent, cfg);
  const evidenceCount = Math.max(0, Number(event.evidence_count ?? 1));
  const materiality = Math.max(0, Number(event.materiality ?? 0));
  const relativeFloor = cfg.relative_floor_pct > 0
    ? Math.max(ctx.materiality_floor, ctx.monthly_income * cfg.relative_floor_pct)
    : 0;
  const materialEnough = relativeFloor <= 0 || materiality >= relativeFloor;
  const evidenceOk = evidenceCount >= cfg.min_evidence_count;
  const growthBlock = growthBlockedBy(ctx);
  const candidates = principlesForTrigger(event.trigger, ctx, event);

  const actionable = event.actionable ?? (bucket !== "closed" && materialEnough);
  const learnedKey = `${event.trigger}:${bucket}`;
  const learnedFit = clamp(Number(ctx.learned?.[learnedKey] ?? 0.5), 0, 1);

  let score = 40 * WINDOW_POSITION[bucket]
    + 25 * (actionable ? 1 : 0)
    + 20 * (evidenceOk && materialEnough ? 1 : 0)
    + 15 * learnedFit;

  const penalties: string[] = [];
  if (bucket === "closed" && !actionable) {
    score -= 40;
    penalties.push("retrospective_without_action");
  }
  const repetitions = Math.max(0, Number(ctx.repetitions ?? 0));
  if (repetitions > 0) {
    score -= Math.min(30, repetitions * 10);
    penalties.push(`repeated_intervention:${repetitions}`);
  }
  const dismissals = Math.max(0, Number(ctx.recent_dismissals ?? 0));
  if (dismissals > 0) {
    score -= Math.min(24, dismissals * 8);
    penalties.push(`recent_dismissals:${dismissals}`);
  }
  score = round2(clamp(score, 0, 100));

  // Elegibilidade: janela aberta, amostra suficiente, materialidade e princípio.
  let reason = "in_window_material_and_actionable";
  let eligible = true;
  let deferUntil: string | null = null;

  if (!cfg.enabled) {
    eligible = false;
    reason = "trigger_disabled_by_policy";
  } else if (candidates.length === 0) {
    eligible = false;
    reason = event.trigger === "MONEY_IN"
      ? `money_in_kind_not_income:${event.money_in_kind ?? "unknown"}`
      : "no_principle_for_trigger";
  } else if (bucket === "pending_open") {
    eligible = false;
    reason = "window_not_open_yet";
    deferUntil = new Date(eventMs + cfg.open_after_hours * HOUR).toISOString();
  } else if (bucket === "closed") {
    eligible = false;
    reason = actionable ? "window_closed_but_actionable" : "retrospective_without_action";
    if (actionable) eligible = true;
  } else if (!evidenceOk) {
    eligible = false;
    reason = `insufficient_evidence:${evidenceCount}/${cfg.min_evidence_count}`;
  } else if (!materialEnough) {
    eligible = false;
    reason = "below_relative_floor";
  }

  return {
    version: BEHAVIORAL_TIMING_VERSION,
    trigger: event.trigger,
    window: bucket,
    window_label: `${event.trigger}:${bucket}`,
    timing_score: score,
    urgency: urgencyFor(score),
    principle_candidates: candidates,
    eligible_now: eligible,
    defer_until: deferUntil,
    reason,
    growth_blocked: growthBlock !== null,
    evidence: {
      contract: BEHAVIORAL_TIMING_VERSION,
      hours_since_event: round2(hoursSinceEvent),
      window_config: cfg,
      window_position: WINDOW_POSITION[bucket],
      materiality,
      relative_floor: round2(relativeFloor),
      material_enough: materialEnough,
      evidence_count: evidenceCount,
      evidence_ok: evidenceOk,
      actionable,
      learned_window_fit: learnedFit,
      learned_key: learnedKey,
      penalties,
      growth_block_reason: growthBlock,
      money_in_kind: event.money_in_kind ?? null,
      economic_event_id: event.economic_event_id ?? null,
      behavioral_event_time: event.occurred_at,
      posting_time_ignored: true,
    },
  };
}

/**
 * Combinação determinística: importância x momento.
 * `priority_score` decide o QUE importa; `timing_score` decide se é AGORA.
 */
export function effectiveScore(priorityScore: number, timingScore: number): number {
  const p = Number.isFinite(priorityScore) ? priorityScore : 0;
  const t = clamp(Number.isFinite(timingScore) ? timingScore : 0, 0, 100);
  return round2(p * (0.55 + 0.45 * (t / 100)));
}

export const TIMING_DEFER_THRESHOLD = 35;

/** Risco crítico nunca é adiado por timing. */
export function shouldDeferByTiming(
  assessment: Pick<TimingAssessment, "timing_score" | "eligible_now">,
  severity: "info" | "attention" | "critical",
): boolean {
  if (severity === "critical") return false;
  if (!assessment.eligible_now) return true;
  return assessment.timing_score < TIMING_DEFER_THRESHOLD;
}

/** Dedup: um evento econômico só gera uma intervenção por princípio/janela. */
export function timingFingerprint(args: {
  trigger: BehavioralTrigger;
  economic_event_id?: string | null;
  occurred_at: string;
  principle: string;
  window: string;
}): string {
  const anchor = args.economic_event_id ?? args.occurred_at.slice(0, 10);
  return [BEHAVIORAL_TIMING_VERSION, args.trigger, anchor, args.principle, args.window].join(":");
}

/** Janela sugerida para reavaliar quando o momento ainda não chegou. */
export function nextWindowAt(event: BehavioralEventInput, cfg?: TimingWindowConfig): string {
  const conf = cfg ?? DEFAULT_TIMING_WINDOWS[event.trigger];
  const base = Date.parse(event.occurred_at);
  const ms = Number.isFinite(base) ? base : Date.now();
  return new Date(ms + conf.open_after_hours * HOUR).toISOString();
}
