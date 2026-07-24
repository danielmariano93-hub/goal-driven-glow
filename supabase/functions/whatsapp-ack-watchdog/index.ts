// Watchdog: recover stuck leases and dead-letter old messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const INTERNAL_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Gate: service-role bearer OR internal cron secret. Never publicly callable.
  const auth = req.headers.get("Authorization") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const authorized =
    auth === `Bearer ${SERVICE_ROLE}` ||
    (INTERNAL_SECRET.length > 0 && providedSecret === INTERNAL_SECRET);
  if (!authorized) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: recovered } = await supabase.rpc("recover_expired_outbound_leases");
  const recoveredCount = Number(recovered ?? 0);

  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: stuck } = await supabase
    .from("outbound_messages")
    .select("id, attempts")
    .in("status", ["queued", "processing"])
    .lt("updated_at", cutoff)
    .limit(50);

  const results: Array<{ id: string; action: string }> = [];
  for (const m of stuck ?? []) {
    const attempts = (m.attempts as number) ?? 0;
    if (attempts >= 6) {
      await supabase.from("outbound_messages").update({ status: "dead" }).eq("id", m.id);
      results.push({ id: m.id as string, action: "dead_letter" });
    } else {
      await supabase.from("outbound_messages").update({
        status: "queued",
        next_attempt_at: new Date(Date.now() + 30_000).toISOString(),
        claimed_at: null,
        lease_expires_at: null,
      }).eq("id", m.id);
      results.push({ id: m.id as string, action: "requeued" });
    }
  }

  // ACK stall: mensagens já enviadas mas sem `delivered_at` há > 10 min.
  const ackStallCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: ackStalled } = await supabase
    .from("outbound_messages")
    .select("id, retry_count")
    .eq("status", "sent")
    .is("delivered_at", null)
    .lt("sent_at", ackStallCutoff)
    .limit(50);
  let stalledCount = 0;
  for (const m of ackStalled ?? []) {
    const rc = Number((m as any).retry_count ?? 0);
    if (rc >= 2) {
      await supabase.from("outbound_messages").update({
        status: "failed",
        last_error: "ack_stalled_no_delivery",
      }).eq("id", m.id);
    } else {
      await supabase.from("outbound_messages").update({
        retry_count: rc + 1,
        last_ack_at: new Date().toISOString(),
      }).eq("id", m.id);
    }
    stalledCount++;
  }

  await writeJobHeartbeat({
    jobKey: "whatsapp-ack-watchdog",
    ok: true,
    processed: recoveredCount + (stuck ?? []).length + stalledCount,
    failed: 0,
    sb: supabase,
  });
  return json({
    recovered: recoveredCount,
    checked: (stuck ?? []).length,
    ack_stalled: stalledCount,
    results,
  });
});

