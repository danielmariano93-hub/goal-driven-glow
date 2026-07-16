// Watchdog: recover stuck leases and dead-letter old messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
  return json({ recovered: recoveredCount, checked: (stuck ?? []).length, results });
});
