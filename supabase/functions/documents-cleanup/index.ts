// Edge Function: documents-cleanup
// Responsibilities:
//   1. Expire long-idle blobs (>7d terminal) and raw_text.
//   2. Expire docs past expires_at.
//   3. Watchdog: resume `processing`/`uploaded` jobs whose heartbeat is stale (>5min).
//   4. Fragment-aware: individual document_fragments stuck in processing >5min
//      are flipped back to pending (if attempts<3) or marked failed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "documents";
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

const INTERNAL_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = req.headers.get("Authorization") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const authorized =
    auth === `Bearer ${SERVICE_ROLE}` ||
    (INTERNAL_SECRET.length > 0 && providedSecret === INTERNAL_SECRET);
  if (!authorized) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let processed = 0, failed = 0, resumed = 0, terminated = 0, fragments_recovered = 0, fragments_failed = 0;

  // 1) Storage retention (>=7d terminal)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: terminals } = await sb.from("document_imports")
    .select("id, storage_path")
    .in("status", ["confirmed", "partially_confirmed", "failed", "canceled"])
    .not("storage_path", "is", null)
    .lt("updated_at", cutoff)
    .limit(200);
  for (const d of terminals ?? []) {
    try {
      if (d.storage_path) await sb.storage.from(BUCKET).remove([d.storage_path as string]);
      await sb.from("document_imports").update({ storage_path: "", raw_text: null }).eq("id", d.id);
      processed++;
    } catch { failed++; }
  }

  // 2) Expire past expires_at
  await sb.from("document_imports").update({ status: "expired" })
    .lt("expires_at", new Date().toISOString())
    .in("status", ["uploaded", "processing", "needs_review", "partial", "partially_confirmed"]);

  // 3) Fragment-level watchdog (executes before document-level, so stuck
  //    fragments are resurrected while their parent doc is still processing).
  const staleISO = new Date(Date.now() - HEARTBEAT_STALE_MS).toISOString();
  const { data: stuckFragments } = await sb.from("document_fragments")
    .select("id,document_id,attempts,fragment_index")
    .eq("status", "processing")
    .lt("updated_at", staleISO)
    .limit(50);
  for (const f of stuckFragments ?? []) {
    const attempts = Number(f.attempts ?? 0);
    if (attempts >= MAX_ATTEMPTS) {
      await sb.from("document_fragments").update({ status: "failed", error_code: "watchdog:max_attempts" }).eq("id", f.id);
      fragments_failed++;
    } else {
      await sb.from("document_fragments").update({ status: "pending", error_code: null }).eq("id", f.id);
      fragments_recovered++;
    }
  }

  // 4) Document-level watchdog
  const { data: stalled } = await sb.from("document_imports")
    .select("id, user_id, status, attempt_count, user_instructions, source, conversation_id")
    .in("status", ["processing", "uploaded"])
    .lt("updated_at", staleISO)
    .limit(20);
  for (const d of stalled ?? []) {
    const attempts = Number(d.attempt_count ?? 0);
    if (attempts >= MAX_ATTEMPTS) {
      await sb.from("document_imports")
        .update({ status: "failed", error: "watchdog:max_attempts" })
        .eq("id", d.id).eq("status", d.status);
      await sb.from("document_processing_events").insert({
        document_id: d.id, user_id: d.user_id, event_type: "processing_failed",
        error_code: "watchdog:max_attempts",
      }).then(() => {}, () => {});
      if (d.source === "whatsapp" && d.conversation_id) {
        const { data: conv } = await sb.from("conversations")
          .select("phone_e164").eq("id", d.conversation_id).maybeSingle();
        const phone = (conv as { phone_e164?: string } | null)?.phone_e164;
        if (phone) {
          await sb.from("outbound_messages").insert({
            user_id: d.user_id, to_phone: phone, kind: "system",
            body: "Não consegui concluir a leitura desse documento após várias tentativas. Você pode reenviar ou tentar por partes.",
          }).then(() => {}, () => {});
        }
      }
      terminated++;
      continue;
    }
    const { error: reErr } = await sb.from("document_imports")
      .update({ status: "uploaded", error: null })
      .eq("id", d.id).eq("status", d.status);
    if (reErr) { failed++; continue; }
    fetch(`${SUPABASE_URL}/functions/v1/assistant-ingest-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({
        mode: d.source === "whatsapp" ? "process-inbound-media" : "resume",
        document_id: d.id,
        user_id: d.user_id,
        guidance: String(d.user_instructions ?? "").slice(0, 500),
      }),
    }).catch(() => {});
    resumed++;
  }

  const nextRun = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  await writeJobHeartbeat({
    jobKey: "documents-cleanup",
    ok: true,
    processed: processed + resumed + terminated + fragments_recovered + fragments_failed,
    failed,
    nextRunAt: nextRun,
    sb,
  });

  return json({ ok: true, processed, failed, resumed, terminated, fragments_recovered, fragments_failed });
});
