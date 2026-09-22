import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const PROACTIVE_WHATSAPP_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;

export type ProactiveWhatsappCadenceDecision = {
  allowed: boolean;
  reason: "no_recent_message" | "interval_elapsed" | "critical_bypass" | "whatsapp_global_cooldown";
  retryAt: string | null;
};

export function evaluateProactiveWhatsappCadence(args: {
  now: Date;
  lastMessageAt?: string | null;
  hasCriticalPending?: boolean;
  minIntervalMs?: number;
}): ProactiveWhatsappCadenceDecision {
  if (args.hasCriticalPending) {
    return { allowed: true, reason: "critical_bypass", retryAt: null };
  }

  const lastAt = args.lastMessageAt ? new Date(args.lastMessageAt).getTime() : Number.NaN;
  if (!Number.isFinite(lastAt)) {
    return { allowed: true, reason: "no_recent_message", retryAt: null };
  }

  const intervalMs = Math.max(0, args.minIntervalMs ?? PROACTIVE_WHATSAPP_MIN_INTERVAL_MS);
  const retryAtMs = lastAt + intervalMs;
  if (args.now.getTime() >= retryAtMs) {
    return { allowed: true, reason: "interval_elapsed", retryAt: null };
  }

  return {
    allowed: false,
    reason: "whatsapp_global_cooldown",
    retryAt: new Date(retryAtMs).toISOString(),
  };
}

export async function loadProactiveWhatsappCadence(
  sb: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<ProactiveWhatsappCadenceDecision> {
  const [lastResp, criticalResp] = await Promise.all([
    sb.from("outbound_messages")
      .select("created_at")
      .eq("user_id", userId)
      .eq("channel", "whatsapp")
      .eq("kind", "proactive")
      .in("status", ["queued", "sent", "delivered"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("pending_proactive_suggestions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("severity", "critical")
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
      .limit(1)
      .maybeSingle(),
  ]);

  if (lastResp.error) throw new Error(`proactive_whatsapp_cadence:last_message:${lastResp.error.message}`);
  if (criticalResp.error) throw new Error(`proactive_whatsapp_cadence:critical_pending:${criticalResp.error.message}`);

  return evaluateProactiveWhatsappCadence({
    now,
    lastMessageAt: (lastResp.data as { created_at?: string } | null)?.created_at ?? null,
    hasCriticalPending: Boolean(criticalResp.data),
  });
}
