import type { CommunicationCandidate } from "./contracts.ts";

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
};


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
};

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";


const ACCEPTED_STATUSES = new Set(["queued", "sent", "delivered", "acted"]);
const BEHAVIOR_KINDS = new Set([
  "emotional_spending",
  "impulsive_spending",
  "financial_procrastination",
  "financial_discipline",
  "relapse_risk",
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


export function decideCommunication(args: {
  candidate: CommunicationCandidate;
  target: "app" | "whatsapp";
  preferences: CommunicationPreferences;
  history: DeliveryHistory[];
  now?: Date;
}): CommunicationDecision {
  const now = args.now ?? new Date();
  const { candidate, preferences, history, target } = args;
  const tz = (preferences.timezone ?? "").trim() || DEFAULT_TIMEZONE;
  const muted = new Set(preferences.muted_proactive_kinds ?? []);


  if (candidate.channel_ready !== "both" && candidate.channel_ready !== target) {
    return { allowed: false, reason: "channel_not_ready", channel: target, priority: 0 };
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
  if (target === "whatsapp" && isQuiet(now, preferences.quiet_start, preferences.quiet_end, tz)) {
    // Silêncio é adiamento, nunca descarte.
    return {
      allowed: false,
      reason: "quiet_hours",
      channel: target,
      priority: 0,
      temporary: (preferences.quiet_behavior ?? "defer") !== "silent",
      retryAt: quietWindowEnd(now, preferences.quiet_end, tz),
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
    return { allowed: false, reason: "dedup_key_14d", channel: target, priority: 0 };
  }

  const sameKind24h = accepted.some((row) =>
    row.kind === candidate.kind &&
    row.channel === target &&
    new Date(row.created_at).getTime() >= now.getTime() - 86_400_000,
  );
  if (sameKind24h) {
    return { allowed: false, reason: "kind_cooldown_24h", channel: target, priority: 0 };
  }

  if (candidate.severity !== "critical") {
    const today = localDay(now, tz);
    const dayRows = accepted.filter((row) => localDay(new Date(row.created_at), tz) === today);
    const dailyCap = Math.max(0, Math.min(5, preferences.max_proactive_per_day ?? 1));
    if (dailyCap === 0 || uniqueCommunications(dayRows) >= dailyCap) {
      return {
        allowed: false, reason: "daily_frequency_cap", channel: target, priority: 0,
        temporary: true, retryAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
      };
    }

    const weekAgo = now.getTime() - 7 * 86_400_000;
    const weekRows = accepted.filter((row) => new Date(row.created_at).getTime() >= weekAgo);
    const weeklyCap = Math.max(1, Math.min(14, preferences.max_proactive_per_week ?? 3));
    if (uniqueCommunications(weekRows) >= weeklyCap) {
      return {
        allowed: false, reason: "weekly_frequency_cap", channel: target, priority: 0,
        temporary: true, retryAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
      };
    }
  }


  const priority = candidate.severity === "critical" ? 300
    : candidate.severity === "attention" ? 200
    : 100;
  return { allowed: true, reason: "eligible", channel: target, priority };
}
