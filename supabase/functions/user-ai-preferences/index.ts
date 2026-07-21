// Edge Function: user-ai-preferences
// Owner-only endpoint to load and save the caller's personalization
// preferences (Fase 3). Reads through Preferences with defaults.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { loadPreferences, savePreferences, DEFAULT_PREFS, type Preferences } from "../_shared/agent/core/PersonalizationEngine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u } = await sbAuth.auth.getUser();
  const user_id = u?.user?.id;
  if (!user_id) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  if (req.method === "GET") {
    return json({ preferences: await loadPreferences(sb, user_id), defaults: DEFAULT_PREFS });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const patch: Partial<Preferences> = {};
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof Preferences)[]) {
    if (body?.[k] !== undefined) patch[k] = body[k];
  }
  const next = await savePreferences(sb, user_id, patch);
  return json({ preferences: next });
});
