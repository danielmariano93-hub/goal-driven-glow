// NotificationDispatcher — turns approved proactive candidates into real
// in-app notifications and optional WhatsApp queue entries.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { decideCommunication, type CommunicationPreferences, type DeliveryHistory } from "../../intelligence/communicationPolicy.ts";
import type { CommunicationCandidate } from "../../intelligence/contracts.ts";

export type DispatchOutcome = {
  id: string;
  channel: string;
  status: "delivered" | "skipped" | "failed";
  reason?: string;
};

function notificationType(kind: string): string {
  if (/achievement|celebr|streak|improvement/i.test(kind)) return "achievement";
  if (/goal/i.test(kind)) return "goal_reached";
  if (/bill|recurr|due/i.test(kind)) return "recurrence_due";
  return "system";
}

async function loadPreferences(sb: SupabaseClient, user_id: string): Promise<CommunicationPreferences> {
  const { data } = await sb.from("notification_preferences")
    .select("proactive_financial,emotional_checkin,smart_tips,whatsapp_proactive,quiet_start,quiet_end,max_proactive_per_week")
    .eq("user_id", user_id).maybeSingle();
  return {
    proactive_financial: (data as any)?.proactive_financial ?? true,
    emotional_checkin: (data as any)?.emotional_checkin ?? true,
    smart_tips: (data as any)?.smart_tips ?? true,
    whatsapp_proactive: (data as any)?.whatsapp_proactive ?? false,
    quiet_start: (data as any)?.quiet_start ?? "21:00",
    quiet_end: (data as any)?.quiet_end ?? "08:00",
    max_proactive_per_week: Number((data as any)?.max_proactive_per_week ?? 3),
  };
}

async function history(sb: SupabaseClient, user_id: string): Promise<DeliveryHistory[]> {
  const { data } = await sb.from("communication_deliveries")
    .select("created_at,kind,channel,status")
    .eq("user_id", user_id)
    .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .order("created_at", { ascending: false }).limit(100);
  return (data as DeliveryHistory[] | null) ?? [];
}

async function record(sb: SupabaseClient, args: {
  user_id: string; suggestion_id: string; kind: string; channel: string;
  status: string; reason?: string; dedup_key?: string; evidence?: unknown;
}) {
  await sb.from("communication_deliveries").upsert({
    user_id: args.user_id,
    suggestion_id: args.suggestion_id,
    kind: args.kind,
    channel: args.channel,
    status: args.status,
    reason: args.reason ?? null,
    dedup_key: args.dedup_key ?? null,
    evidence: args.evidence ?? {},
    delivered_at: args.status === "delivered" ? new Date().toISOString() : null,
  }, { onConflict: "suggestion_id,channel" });
}

export async function dispatchSuggestions(
  sb: SupabaseClient,
  user_id: string,
  opts: { channel?: "app" | "whatsapp"; max?: number } = {},
): Promise<DispatchOutcome[]> {
  const { data } = await sb.from("pending_proactive_suggestions")
    .select("id,user_id,channel_ready,kind,title,body,severity,dedup_key,action,evidence")
    .eq("user_id", user_id).eq("status", "pending")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: true }).limit(opts.max ?? 5);
  const rows = ((data as any[] | null) ?? []) as CommunicationCandidate[];
  const prefs = await loadPreferences(sb, user_id);
  const recent = await history(sb, user_id);
  const targets: Array<"app" | "whatsapp"> = opts.channel ? [opts.channel] : ["app", "whatsapp"];
  const results: DispatchOutcome[] = [];

  const { data: link } = await sb.from("whatsapp_links")
    .select("phone_e164").eq("user_id", user_id).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  for (const candidate of rows) {
    let anyQueued = false;
    for (const target of targets) {
      const decision = decideCommunication({ candidate, target, preferences: prefs, history: recent });
      if (!decision.allowed) {
        await record(sb, {
          user_id, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
          status: "suppressed", reason: decision.reason, dedup_key: candidate.dedup_key,
          evidence: candidate.evidence,
        });
        results.push({ id: candidate.id, channel: target, status: "skipped", reason: decision.reason });
        continue;
      }

      try {
        if (target === "app") {
          const actionUrl = typeof candidate.action?.route === "string" ? candidate.action.route : null;
          await sb.from("notifications").upsert({
            user_id,
            type: notificationType(candidate.kind),
            title: candidate.title,
            body: candidate.body,
            action_url: actionUrl,
            dedup_key: `proactive:${candidate.dedup_key}`,
          }, { onConflict: "user_id,dedup_key" });
          await record(sb, {
            user_id, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
            status: "delivered", reason: "in_app_notification_created",
            dedup_key: candidate.dedup_key, evidence: candidate.evidence,
          });
          anyQueued = true;
          results.push({ id: candidate.id, channel: target, status: "delivered" });
        } else {
          if (!(link as any)?.phone_e164) {
            await record(sb, {
              user_id, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
              status: "suppressed", reason: "no_active_whatsapp_link",
              dedup_key: candidate.dedup_key, evidence: candidate.evidence,
            });
            results.push({ id: candidate.id, channel: target, status: "skipped", reason: "no_active_whatsapp_link" });
            continue;
          }
          await sb.from("outbound_messages").insert({
            user_id,
            to_phone: (link as any).phone_e164,
            body: `${candidate.title}\n\n${candidate.body}`,
            provider: "waha",
            status: "queued",
            kind: "proactive",
            channel: "whatsapp",
            idempotency_key: `proactive:${candidate.id}:whatsapp`,
            context_type: "proactive_suggestion",
            context_id: candidate.id,
            surface: "whatsapp",
            feature: "proactive_communication",
            metadata: { suggestion_kind: candidate.kind, severity: candidate.severity, evidence: candidate.evidence },
          });
          await record(sb, {
            user_id, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
            status: "queued", reason: "whatsapp_queued",
            dedup_key: candidate.dedup_key, evidence: candidate.evidence,
          });
          anyQueued = true;
          results.push({ id: candidate.id, channel: target, status: "delivered" });
        }
      } catch (e) {
        const reason = String((e as Error).message).slice(0, 160);
        await record(sb, {
          user_id, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
          status: "failed", reason, dedup_key: candidate.dedup_key, evidence: candidate.evidence,
        });
        results.push({ id: candidate.id, channel: target, status: "failed", reason });
      }
    }
    await sb.from("pending_proactive_suggestions").update({
      status: anyQueued ? "dispatched" : "dismissed",
      dispatched_at: anyQueued ? new Date().toISOString() : null,
      dismissed_at: anyQueued ? null : new Date().toISOString(),
    }).eq("id", candidate.id).eq("status", "pending");
  }
  return results;
}
