import type { CommunicationCandidate } from "./contracts.ts";
import { DEFAULT_CARE_QUOTA, isCareKind, type CareQuota } from "./careKinds.ts";

export type CommunicationPreferences = {
  proactive_financial?: boolean;
  emotional_checkin?: boolean;
  smart_tips?: boolean;
  whatsapp_proactive?: boolean;
  quiet_start?: string | null;
  quiet_end?: string | null;
  max_proactive_per_week?: number;
  max_proactive_per_day?: number;
  muted_proactive_kinds?: string[];
  timezone?: string | null;
  quiet_behavior?: "defer" | "silent" | "immediate" | null;
  anticipation_enabled?: boolean;
  anticipation_whatsapp?: boolean;
  anticipation_kinds?: string[] | null;
};

/** Tipos originados do motor de antecipação (exigem consentimento específico). */
export const ANTICIPATION_KINDS = new Set([
  "card_cycle_acceleration",
  "expected_recurring_payment",
  "month_phase_spending_risk",
  "small_spend_acceleration",
  "upcoming_cash_pressure",
  "weekday_spending_risk",
  "weekend_spending_risk",
]);



export type DeliveryHistory = {
  created_at: string;
  kind: string;
  channel: string;
  status: string;
  dedup_key?: string | null;
};

export type CommunicationDecision = {
  allowed: boolean;
  reason: string;
  channel: "app" | "whatsapp";
  priority: number;
  /** Bloqueio temporário (quiet hours / cap): a comunicação deve ser adiada, não descartada. */
  temporary?: boolean;
  retryAt?: string | null;
  /** `nino_comm_priority.v1` — a comunicação furou um cap por relevância. */
  cap_override?: boolean;
  /** Motivo que teria bloqueado se não houvesse override. */
  cap_original_reason?: string | null;
  /** Score de prioridade lido do candidato (0 quando ausente). */
  priority_score?: number;
  /** Faixa de relevância aplicada. */
  priority_band?: "low" | "medium" | "high" | "very_high";
};

// ---------------------------------------------------------------------------
// nino_comm_priority.v1 — orçamento de atenção com peso e override
// ---------------------------------------------------------------------------
export const NINO_COMM_PRIORITY_VERSION = "nino_comm_priority.v1";

export type AttentionWeights = { care: number; informational: number; financial: number };

export type CommunicationPolicySettings = {
  pilot_mode: boolean;
  /** Fase piloto restrita: lista vazia = piloto vale para todos. */
  pilot_user_ids: string[];
  high_priority_threshold: number;
  critical_priority_threshold: number;
  allow_high_priority_override: boolean;
  high_priority_kinds: string[];
  cap_behavior: "defer" | "suppress";
  quiet_hours_high_priority_behavior: "defer" | "immediate";
  attention_weights: AttentionWeights;
  pilot_budget_multiplier: number;
};

/**
 * Padrão do código = comportamento atual (conservador). O piloto e o override
 * são ligados explicitamente pela configuração do admin, nunca por omissão.
 */
export const DEFAULT_COMMUNICATION_POLICY: CommunicationPolicySettings = {
  pilot_mode: false,
  pilot_user_ids: [],
  high_priority_threshold: 75,
  critical_priority_threshold: 90,
  allow_high_priority_override: false,
  high_priority_kinds: [],
  cap_behavior: "suppress",
  quiet_hours_high_priority_behavior: "defer",
  attention_weights: { care: 1, informational: 2, financial: 4 },
  pilot_budget_multiplier: 3,
};

export function normalizeCommunicationPolicy(raw: unknown): CommunicationPolicySettings {
  const row = (raw ?? {}) as Record<string, unknown>;
  const w = (row.attention_weights ?? {}) as Record<string, unknown>;
  const num = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const behavior = String(row.cap_behavior ?? "");
  const quiet = String(row.quiet_hours_high_priority_behavior ?? "");
  return {
    pilot_mode: row.pilot_mode === true,
    pilot_user_ids: Array.isArray(row.pilot_user_ids)
      ? row.pilot_user_ids.map((id) => String(id)).filter(Boolean) : [],
    high_priority_threshold: num(row.high_priority_threshold, 75),
    critical_priority_threshold: num(row.critical_priority_threshold, 90),
    allow_high_priority_override: row.allow_high_priority_override === true,
    high_priority_kinds: Array.isArray(row.high_priority_kinds)
      ? row.high_priority_kinds.map((k) => String(k)) : [],
    cap_behavior: behavior === "defer" ? "defer" : "suppress",
    quiet_hours_high_priority_behavior: quiet === "immediate" ? "immediate" : "defer",
    attention_weights: {
      care: num(w.care, 1),
      informational: num(w.informational, 2),
      financial: num(w.financial, 4),
    },
    pilot_budget_multiplier: Math.min(20, Math.max(1, num(row.pilot_budget_multiplier, 3))),
  };
}
/**
 * Piloto restrito: quando há clientes listados, quem está fora recebe a
 * política conservadora (piloto desligado e sem override por relevância).
 */
export function policyForUser(
  policy: CommunicationPolicySettings,
  userId: string,
): CommunicationPolicySettings {
  if (!policy.pilot_mode) return policy;
  if (policy.pilot_user_ids.length === 0) return policy;
  if (policy.pilot_user_ids.includes(userId)) return policy;
  return { ...policy, pilot_mode: false, allow_high_priority_override: false };
}


/** Score real do candidato: nunca inventado — vem do ranking determinístico. */
export function candidatePriorityScore(candidate: CommunicationCandidate): number {
  const ev = (candidate.evidence ?? {}) as Record<string, unknown>;
  for (const key of ["priority_score", "value_score"]) {
    const n = Number(ev[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function priorityBand(
  score: number,
  policy: CommunicationPolicySettings,
): "low" | "medium" | "high" | "very_high" {
  if (score >= policy.critical_priority_threshold) return "very_high";
  if (score >= policy.high_priority_threshold) return "high";
  if (score >= 50) return "medium";
  return "low";
}

/** Peso de atenção do tipo: cuidado < informativo < decisão financeira. */
export function attentionWeightOf(kind: string, policy: CommunicationPolicySettings): number {
  if (isCareKind(kind)) return policy.attention_weights.care;
  if (SMART_TIP_KINDS.has(kind) || BEHAVIOR_KINDS.has(kind)) return policy.attention_weights.informational;
  return policy.attention_weights.financial;
}



export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

const ACCEPTED_STATUSES = new Set(["queued", "sent", "delivered", "acted"]);
const BEHAVIOR_KINDS = new Set([
  "emotional_spending",
  "impulsive_spending",
  "financial_procrastination",
  "financial_discipline",
  "relapse_risk",
  // Lembrete de cuidado: pertence ao consentimento de check-in emocional,
  // não ao consentimento de insight financeiro.
  "emotional_checkin_due",
]);
const SMART_TIP_KINDS = new Set([
  "saving_opportunity",
  "underused_subscription",
  "recurring_pattern",
  "engagement_drop",
]);

function minutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{2}:\d{2}/.test(hhmm)) return null;
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function isQuiet(now: Date, start: string | null | undefined, end: string | null | undefined, tz: string): boolean {
  const s = minutes(start); const e = minutes(end);
  if (s === null || e === null || s === e) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now).split(":").map(Number);
  const n = parts[0] * 60 + parts[1];
  return s < e ? n >= s && n < e : n >= s || n < e;
}

/** Próximo instante fora do horário de silêncio, no fuso do usuário. */
export function quietWindowEnd(now: Date, end: string | null | undefined, tz: string): string {
  const e = minutes(end);
  if (e === null) return new Date(now.getTime() + 3_600_000).toISOString();
  for (let step = 1; step <= 24 * 4; step++) {
    const candidate = new Date(now.getTime() + step * 15 * 60_000);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(candidate).split(":").map(Number);
    if (parts[0] * 60 + parts[1] >= e) return candidate.toISOString();
  }
  return new Date(now.getTime() + 3_600_000).toISOString();
}

function localDay(value: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/**
 * Cap contado por comunicação lógica (dedup_key), não por entrega de canal:
 * a mesma comunicação enviada no app e no WhatsApp conta uma única vez.
 */
function uniqueCommunications(rows: DeliveryHistory[]): number {
  return new Set(rows.map((row) =>
    row.dedup_key ? `logical:${row.dedup_key}` : `logical:${row.kind}:${row.created_at}`,
  )).size;
}

/** Pontos de atenção já consumidos na janela (por comunicação lógica). */
function usedAttentionPoints(rows: DeliveryHistory[], policy: CommunicationPolicySettings): number {
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const key = row.dedup_key ? `logical:${row.dedup_key}` : `logical:${row.kind}:${row.created_at}`;
    const weight = attentionWeightOf(row.kind, policy);
    byKey.set(key, Math.max(byKey.get(key) ?? 0, weight));
  }
  let total = 0;
  for (const weight of byKey.values()) total += weight;
  return total;
}



export function decideCommunication(args: {
  candidate: CommunicationCandidate;
  target: "app" | "whatsapp";
  preferences: CommunicationPreferences;
  history: DeliveryHistory[];
  /** Cota própria dos lembretes de cuidado (configurável no painel admin). */
  careQuota?: CareQuota;
  /** Configuração de prioridade/piloto (`nino_comm_priority.v1`). */
  policy?: CommunicationPolicySettings;
  now?: Date;
}): CommunicationDecision {
  const now = args.now ?? new Date();
  const { candidate, preferences, history, target } = args;
  const tz = (preferences.timezone ?? "").trim() || DEFAULT_TIMEZONE;
  const muted = new Set(preferences.muted_proactive_kinds ?? []);
  const policy = args.policy ?? DEFAULT_COMMUNICATION_POLICY;
  const score = candidatePriorityScore(candidate);
  const band = priorityBand(score, policy);
  const highRelevanceKind = policy.high_priority_kinds.includes(candidate.kind);
  const canOverrideCap = candidate.severity === "critical" ||
    ((policy.allow_high_priority_override || policy.pilot_mode) &&
      (band === "high" || band === "very_high" || (highRelevanceKind && band !== "low")));



  // Elegibilidade de canal e severidade pertence ao communication_catalog,
  // aplicado pelo dispatcher antes desta política. `channel_ready` permanece
  // apenas como metadado de compatibilidade para sugestões históricas.
  if (ANTICIPATION_KINDS.has(candidate.kind)) {
    if (preferences.anticipation_enabled === false) {
      return { allowed: false, reason: "anticipation_opt_out", channel: target, priority: 0 };
    }
    if (target === "whatsapp" && preferences.anticipation_whatsapp === false) {
      return { allowed: false, reason: "anticipation_whatsapp_opt_out", channel: target, priority: 0 };
    }
    const kinds = preferences.anticipation_kinds;
    if (Array.isArray(kinds) && kinds.length > 0 && !kinds.includes(candidate.kind)) {
      return { allowed: false, reason: "anticipation_kind_disabled", channel: target, priority: 0 };
    }
  }
  if (muted.has(candidate.kind)) {
    return { allowed: false, reason: "kind_opt_out", channel: target, priority: 0 };
  }
  if (BEHAVIOR_KINDS.has(candidate.kind) && preferences.emotional_checkin === false) {
    return { allowed: false, reason: "emotional_opt_out", channel: target, priority: 0 };
  }
  if (SMART_TIP_KINDS.has(candidate.kind) && preferences.smart_tips === false) {
    return { allowed: false, reason: "smart_tips_opt_out", channel: target, priority: 0 };
  }
  if (!BEHAVIOR_KINDS.has(candidate.kind) &&
      !SMART_TIP_KINDS.has(candidate.kind) &&
      preferences.proactive_financial === false) {
    return { allowed: false, reason: "financial_opt_out", channel: target, priority: 0 };
  }
  if (target === "whatsapp" && !preferences.whatsapp_proactive) {
    return { allowed: false, reason: "whatsapp_opt_out", channel: target, priority: 0 };
  }
  const quietNow = target === "whatsapp" &&
    isQuiet(now, preferences.quiet_start, preferences.quiet_end, tz);
  const quietBypass = quietNow &&
    (band === "high" || band === "very_high") &&
    policy.quiet_hours_high_priority_behavior === "immediate" &&
    (policy.allow_high_priority_override || policy.pilot_mode);
  if (quietNow && !quietBypass) {
    // Silêncio é adiamento, nunca descarte.
    return {
      allowed: false,
      reason: "quiet_hours",
      channel: target,
      priority: 0,
      temporary: (preferences.quiet_behavior ?? "defer") !== "silent",
      retryAt: quietWindowEnd(now, preferences.quiet_end, tz),
      priority_score: score,
      priority_band: band,
    };
  }


  const accepted = history.filter((row) => ACCEPTED_STATUSES.has(row.status));
  const fourteenDaysAgo = now.getTime() - 14 * 86_400_000;
  const exactDuplicate = accepted.some((row) =>
    row.channel === target &&
    row.dedup_key === candidate.dedup_key &&
    new Date(row.created_at).getTime() >= fourteenDaysAgo,
  );
  if (exactDuplicate) {
    return { allowed: false, reason: "dedup_key_14d", channel: target, priority: 0, priority_score: score, priority_band: band };
  }

  const sameKind24h = accepted.some((row) =>
    row.kind === candidate.kind &&
    row.channel === target &&
    new Date(row.created_at).getTime() >= now.getTime() - 86_400_000,
  );
  if (sameKind24h) {
    return { allowed: false, reason: "kind_cooldown_24h", channel: target, priority: 0, priority_score: score, priority_band: band };
  }

  let capOverride = false;
  let capOriginalReason: string | null = null;

  if (candidate.severity !== "critical") {
    // Cuidado e insight financeiro têm cotas separadas: um lembrete carinhoso
    // não consome a vez de um alerta de caixa (nem o contrário).
    const care = isCareKind(candidate.kind);
    const quota: CareQuota = args.careQuota ?? DEFAULT_CARE_QUOTA;
    const scoped = accepted.filter((row) => isCareKind(row.kind) === care);
    const today = localDay(now, tz);
    const dayRows = scoped.filter((row) => localDay(new Date(row.created_at), tz) === today);
    const dailyCap = care
      ? Math.max(0, Math.min(5, quota.maxPerDay))
      : Math.max(0, Math.min(5, preferences.max_proactive_per_day ?? 1));

    // Orçamento de atenção ponderado: o cap do admin continua o guardrail, mas
    // é convertido em pontos — duas mensagens leves não consomem a vez de uma
    // decisão financeira.
    const unit = policy.attention_weights.financial;
    const multiplier = policy.pilot_mode ? policy.pilot_budget_multiplier : 1;
    const candidateWeight = attentionWeightOf(candidate.kind, policy);
    const budgetFor = (cap: number) => cap * unit * multiplier;

    const exceeded = (rows: DeliveryHistory[], cap: number) => {
      if (cap === 0) return true;
      if (unit <= 0) return uniqueCommunications(rows) >= cap;
      return usedAttentionPoints(rows, policy) + candidateWeight > budgetFor(cap);
    };

    const capBlock = (reason: string, retryAt: string): CommunicationDecision | null => {
      if (canOverrideCap) {
        capOverride = true;
        capOriginalReason = reason;
        return null;
      }
      const defer = policy.cap_behavior === "defer" || band === "medium";
      return {
        allowed: false,
        reason: band === "medium" && defer ? "medium_priority_frequency_defer" : reason,
        channel: target,
        priority: 0,
        temporary: defer,
        retryAt: defer ? retryAt : null,
        cap_original_reason: reason,
        priority_score: score,
        priority_band: band,
      };
    };

    if (exceeded(dayRows, dailyCap)) {
      const blocked = capBlock("daily_frequency_cap", new Date(now.getTime() + 24 * 3_600_000).toISOString());
      if (blocked) return blocked;
    }

    const weekAgo = now.getTime() - 7 * 86_400_000;
    const weekRows = scoped.filter((row) => new Date(row.created_at).getTime() >= weekAgo);
    const weeklyCap = care
      ? Math.max(0, Math.min(21, quota.maxPerWeek))
      : Math.max(1, Math.min(14, preferences.max_proactive_per_week ?? 3));
    if (exceeded(weekRows, weeklyCap)) {
      const blocked = capBlock("weekly_frequency_cap", new Date(now.getTime() + 3 * 86_400_000).toISOString());
      if (blocked) return blocked;
    }
  }



  const severityPriority = candidate.severity === "critical" ? 300
    : candidate.severity === "attention" ? 200
    : 100;
  // O score real do ranking desempata dentro da mesma severidade.
  const priority = severityPriority + Math.min(99, Math.round(score));
  return {
    allowed: true,
    reason: "eligible",
    channel: target,
    priority,
    cap_override: capOverride || undefined,
    cap_original_reason: capOriginalReason,
    priority_score: score,
    priority_band: band,
  };
}
