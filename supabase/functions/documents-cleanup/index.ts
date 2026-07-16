// Edge Function: documents-cleanup
// Deletes storage blobs and raw_text after 7 days from finalization/failure,
// and expires documents at their expires_at (default 30 days).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "documents";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let processed = 0, failed = 0;

  // 1) Remove storage blob + raw_text for docs terminal >= 7 days
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: terminals } = await sb.from("document_imports")
    .select("id, storage_path")
    .in("status", ["confirmed", "partially_confirmed", "failed", "canceled"])
    .not("storage_path", "is", null)
    .lt("updated_at", cutoff)
    .limit(200);
  for (const d of terminals ?? []) {
    try {
      if (d.storage_path) {
        await sb.storage.from(BUCKET).remove([d.storage_path as string]);
      }
      await sb.from("document_imports").update({ storage_path: "", raw_text: null }).eq("id", d.id);
      processed++;
    } catch {
      failed++;
    }
  }

  // 2) Expire docs past expires_at
  await sb.from("document_imports").update({ status: "expired" })
    .lt("expires_at", new Date().toISOString())
    .in("status", ["uploaded", "processing", "needs_review", "partially_confirmed"]);

  const nextRun = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  await writeJobHeartbeat({
    jobKey: "documents-cleanup",
    ok: true,
    processed, failed,
    nextRunAt: nextRun,
    sb,
  });

  return json({ ok: true, processed, failed });
});
