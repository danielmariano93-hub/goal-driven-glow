import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider } from "../_shared/messaging/waha.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "", {
    global: { headers: { Authorization: auth } },
  });
  const { data: userRes, error } = await supabase.auth.getUser();
  if (error || !userRes.user) return json({ error: "unauthorized" }, 401);
  const { data: adm } = await supabase.rpc("is_current_user_admin");
  if (adm !== true) return json({ error: "forbidden" }, 403);

  const provider = getProvider();
  const configured = provider.configured;
  const secrets = {
    WAHA_BASE_URL: Boolean(Deno.env.get("WAHA_BASE_URL")),
    WAHA_API_KEY: Boolean(Deno.env.get("WAHA_API_KEY")),
    WAHA_SESSION: Boolean(Deno.env.get("WAHA_SESSION")),
    WAHA_WEBHOOK_SECRET: Boolean(Deno.env.get("WAHA_WEBHOOK_SECRET")),
  };

  if (!configured) return json({ configured: false, secrets, health: null, session: null });

  const [health, session] = await Promise.all([provider.getHealth(), provider.getSessionStatus()]);
  // Best-effort health record (ignore failures)
  const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await service.from("provider_health_events").insert({
    provider: "waha", ok: health.ok, latency_ms: health.latency_ms, error_masked: health.error ?? null,
  });
  return json({ configured: true, secrets, health, session });
});
