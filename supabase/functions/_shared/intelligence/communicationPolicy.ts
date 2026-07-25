import type { CommunicationCandidate } from "./contracts.ts";

export type CommunicationPreferences = {
  proactive_financial?: boolean;
  emotional_checkin?: boolean;
  smart_tips?: boolean;
  whatsapp_proactive?: boolean;
  quiet_start?: string | null;
  quiet_end?: string | null;
  max_proactive_per_week?: number;
};

export type DeliveryHistory = { created_at: string; kind: string; channel: string; status: string };
export type CommunicationDecision = {
  allowed: boolean;
  reason: string;
  channel: "app" | "whatsapp";
  priority: number;
};

function minutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{2}:\d{2}/.test(hhmm)) return null;
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function isQuiet(now: Date, start?: string | null, end?: string | null): boolean {
  const s = minutes(start); const e = minutes(end);
  if (s === null || e === null || s === e) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":").map(Number);
  const n = parts[0] * 60 + parts[1];
  return s < e ? n >= s && n < e : n >= s || n < e;
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
  if (candidate.channel_ready !== "both" && candidate.channel_ready !== target) return { allowed: false, reason: "channel_not_ready", channel: target, priority: 0 };
  if (target === "whatsapp" && !preferences.whatsapp_proactive) return { allowed: false, reason: "whatsapp_opt_out", channel: target, priority: 0 };
  if (target === "whatsapp" && isQuiet(now, preferences.quiet_start, preferences.quiet_end)) return { allowed: false, reason: "quiet_hours", channel: target, priority: 0 };

  const weekAgo = now.getTime() - 7 * 86400000;
  const week = history.filter(h => new Date(h.created_at).getTime() >= weekAgo && ["queued", "sent", "delivered"].includes(h.status));
  const cap = Math.max(1, Math.min(7, preferences.max_proactive_per_week ?? 3));
  if (candidate.severity !== "critical" && week.length >= cap) return { allowed: false, reason: "weekly_frequency_cap", channel: target, priority: 0 };

  const sameKind24h = history.some(h => h.kind === candidate.kind && new Date(h.created_at).getTime() >= now.getTime() - 86400000);
  if (sameKind24h) return { allowed: false, reason: "kind_cooldown_24h", channel: target, priority: 0 };

  const priority = candidate.severity === "critical" ? 300 : candidate.severity === "attention" ? 200 : 100;
  return { allowed: true, reason: "eligible", channel: target, priority };
}
