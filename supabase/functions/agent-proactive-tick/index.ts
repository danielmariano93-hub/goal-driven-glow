// Edge Function: agent-proactive-tick
// Cron endpoint that scans users for proactive suggestions.
// Can be called with { user_id } to scan a single user, or without body
// to scan the top-N active users. Requires x-cron-secret matching
// INTERNAL_CRON_SECRET, OR a platform_admin bearer token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { scanUser } from "../_shared/agent/core/ProactiveEngine.ts";
import { recomputeProfile } from "../_shared/agent/core/UserProfile.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // AuthN: cron secret OR platform_admin bearer.
  const cron = req.headers.get("x-cron-secret") ?? "";
  const bearer = req.headers.get("Authorization") ?? "";
  let authorised = CRON_SECRET !== "" && cron === CRON_SECRET;
  if (!authorised && bearer.startsWith("Bearer ")) {
    const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: bearer } }, auth: { persistSession: false },
    });
    const { data } = await sbAuth.auth.getUser();
    if (data?.user?.id) {
      const { data: admin } = await sb.from("platform_admins")
        .select("active").eq("user_id", data.user.id).maybeSingle();
      authorised = !!admin && !!(admin as any).active;
    }
  }
  if (!authorised) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  let userIds: string[] = [];
  if (body?.user_id) {
    userIds = [String(body.user_id)];
  } else {
    // Pick top-N users active in the last 14 days (best-effort).
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data } = await sb.from("agent_runs")
      .select("user_id").gte("started_at", cutoff).limit(500);
    userIds = Array.from(new Set(((data as any[]) ?? []).map(r => r.user_id))).slice(0, 30);
  }

  const results: Array<{ user_id: string; suggestions: number; error?: string }> = [];
  for (const uid of userIds) {
    try {
      await recomputeProfile(sb, uid);
      const s = await scanUser(sb, uid);
      results.push({ user_id: uid, suggestions: s.length });
    } catch (e) {
      results.push({ user_id: uid, suggestions: 0, error: String((e as Error).message).slice(0, 160) });
    }
  }
  return json({ scanned: userIds.length, results });
});
