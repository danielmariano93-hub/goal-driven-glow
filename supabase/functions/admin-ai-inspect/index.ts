// Edge Function: admin-ai-inspect
// Read-only endpoint used by the Admin IA dashboard to inspect a user's
// memory, profile snapshot, preferences, recent decisions and proactive
// suggestions. Requires platform_admin (owner/admin/support/analyst).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await sbAuth.auth.getUser();
  const callerId = userData?.user?.id;
  if (userErr || !callerId) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Require platform_admin membership.
  const { data: adminRow } = await sb.from("platform_admins")
    .select("role, active").eq("user_id", callerId).maybeSingle();
  if (!adminRow || !(adminRow as any).active) return json({ error: "forbidden" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const target_user_id = String(body?.user_id ?? "").trim();
  if (!target_user_id) return json({ error: "user_id required" }, 400);

  try {
    const [mem, snapshot, prefs, decisions, suggestions, runs] = await Promise.all([
      sb.from("agent_memory").select("*").eq("user_id", target_user_id)
        .order("updated_at", { ascending: false }).limit(80),
      sb.from("user_profiles_snapshot").select("*").eq("user_id", target_user_id).maybeSingle(),
      sb.from("user_ai_preferences").select("*").eq("user_id", target_user_id).maybeSingle(),
      sb.from("agent_decisions").select("*").eq("user_id", target_user_id)
        .order("created_at", { ascending: false }).limit(40),
      sb.from("pending_proactive_suggestions").select("*").eq("user_id", target_user_id)
        .order("created_at", { ascending: false }).limit(30),
      sb.from("agent_runs").select("id,status,path,steps,tokens_in,tokens_out,latency_ms,started_at,ended_at,error_sanitized")
        .eq("user_id", target_user_id).order("started_at", { ascending: false }).limit(20),
    ]);

    return json({
      memory: mem.data ?? [],
      profile_snapshot: snapshot.data ?? null,
      preferences: prefs.data ?? null,
      decisions: decisions.data ?? [],
      suggestions: suggestions.data ?? [],
      recent_runs: runs.data ?? [],
    });
  } catch (e) {
    return json({ error: String((e as Error).message).slice(0, 200) }, 500);
  }
});
