// Outbound worker. Uses claim_outbound_batch (SKIP LOCKED) with lease-only
// semantics: rows go queued → processing, then only after the provider
// accepts do we call mark_outbound_sent. If the send fails, we requeue
// with exponential backoff. Expired leases are recovered by the watchdog.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider, loadWahaConfig } from "../_shared/messaging/waha.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { ok: false as const, status: 401 };
  const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "", {
    global: { headers: { Authorization: auth } },
  });
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return { ok: false as const, status: 401 };
  const { data: adm } = await supabase.rpc("is_current_user_admin");
  if (adm !== true) return { ok: false as const, status: 403 };
  return { ok: true as const };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = req.headers.get("Authorization") ?? "";
  const isService = auth === `Bearer ${SERVICE_ROLE}`;
  if (!isService) {
    const gate = await requireAdmin(req);
    if (!gate.ok) return json({ error: "forbidden" }, gate.status);
  }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await loadWahaConfig(sb);
  const provider = getProvider();
  if (!provider.configured) return json({ ok: false, error: "not_configured" }, 503);

  // Best-effort lease recovery on every tick
  await sb.rpc("recover_expired_outbound_leases");

  const { data: claimed, error } = await sb.rpc("claim_outbound_batch", { p_limit: 10 });
  if (error) return json({ error: error.message }, 500);
  const rows = (claimed as Array<{ id: string; to_phone: string; body: string; attempts: number }> | null) ?? [];

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const m of rows) {
    try {
      // Verifica se a linha carrega artefato para envio como imagem
      const { data: extra } = await sb.from("outbound_messages")
        .select("artifact_id,media_url,media_mime").eq("id", m.id).maybeSingle();
      let providerId: string | null = null;
      let mediaUrl: string | null = extra?.media_url ?? null;
      let mediaStatus: "none" | "delivered" | "failed" | "fallback_text" = "none";

      if (extra?.artifact_id && !mediaUrl) {
        try {
          const rr = await fetch(`${SUPABASE_URL}/functions/v1/artifact-render`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
            body: JSON.stringify({ artifact_id: extra.artifact_id }),
          });
          const j = await rr.json().catch(() => ({}));
          if (j?.ok && j?.media_url) mediaUrl = j.media_url;
        } catch (_e) { /* fallback textual */ }
      }

      if (mediaUrl && provider.sendImage) {
        try {
          const r = await provider.sendImage(m.to_phone, mediaUrl, m.body);
          providerId = r.provider_message_id;
          mediaStatus = "delivered";
        } catch (_e) {
          // fallback textual
          const r = await provider.sendText(m.to_phone, m.body);
          providerId = r.provider_message_id;
          mediaStatus = "fallback_text";
        }
      } else {
        const r = await provider.sendText(m.to_phone, m.body);
        providerId = r.provider_message_id;
        mediaStatus = extra?.artifact_id ? "fallback_text" : "none";
      }

      const { error: markErr } = await sb.rpc("mark_outbound_sent", {
        p_id: m.id, p_provider_message_id: providerId ?? null,
      });
      if (markErr) throw new Error(markErr.message);
      if (extra?.artifact_id) {
        await sb.from("outbound_messages").update({
          media_status: mediaStatus, media_url: mediaUrl,
        }).eq("id", m.id);
        await sb.from("agent_artifacts").update({
          delivered_at: mediaStatus === "delivered" ? new Date().toISOString() : null,
          delivery_status: mediaStatus,
        }).eq("id", extra.artifact_id).then(() => {}, () => {});
      }
      results.push({ id: m.id, ok: true });
    } catch (e) {
      const attempts = m.attempts + 1;
      const backoffMs = Math.min(60_000 * Math.pow(2, attempts), 30 * 60_000);
      const dead = attempts >= 6;
      await sb.from("outbound_messages").update({
        status: dead ? "dead" : "queued",
        next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
        last_error: String((e as Error).message).slice(0, 200),
        claimed_at: null,
        lease_expires_at: null,
      }).eq("id", m.id);
      results.push({ id: m.id, ok: false, error: String((e as Error).message) });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  await writeJobHeartbeat({
    jobKey: "whatsapp-send",
    ok: failed === 0,
    processed: results.length,
    failed,
    sb,
  });
  return json({ processed: results.length, results });
});

