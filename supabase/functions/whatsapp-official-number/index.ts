// Authenticated read-only endpoint: returns the official WhatsApp number resolved
// from the connected WAHA session. Never returns URLs, API keys or webhook secrets.
// Contract: { available: boolean, official_number: string | null, source: "waha" | "cache" | "unconfigured" | "not_connected" | "error" }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider, loadWahaConfig, isWahaConfigured } from "../_shared/messaging/waha.ts";
import { normalizeBrPhone } from "../_shared/messaging/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Cache = { at: number; number: string | null };
let mem: Cache | null = null;
const TTL_MS = 60_000;

async function readCache(svc: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await svc
    .from("platform_public_config")
    .select("value")
    .eq("key", "official_whatsapp_number")
    .maybeSingle();
  const v = (data as { value?: string } | null)?.value ?? null;
  return v ? normalizeBrPhone(v) : null;
}

async function writeCache(svc: ReturnType<typeof createClient>, number: string) {
  await svc.from("platform_public_config").upsert({
    key: "official_whatsapp_number",
    value: number,
    updated_at: new Date().toISOString(),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const anon = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userRes, error: authErr } = await anon.auth.getUser();
  if (authErr || !userRes.user) return json({ error: "unauthorized" }, 401);

  // In-memory cache hit
  if (mem && Date.now() - mem.at < TTL_MS) {
    return json({
      available: Boolean(mem.number),
      official_number: mem.number,
      source: mem.number ? "cache" : "not_connected",
    });
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await loadWahaConfig(svc);

  if (!isWahaConfigured()) {
    const fallback = await readCache(svc);
    if (fallback) {
      mem = { at: Date.now(), number: fallback };
      return json({ available: true, official_number: fallback, source: "cache" });
    }
    return json({ available: false, official_number: null, source: "unconfigured" });
  }

  const provider = getProvider();
  try {
    const [session, me] = await Promise.all([
      provider.getSessionStatus(),
      provider.getMe(),
    ]);
    const status = (session?.status ?? "").toUpperCase();
    const phone = me?.phone ? normalizeBrPhone(me.phone) : null;
    if (status === "WORKING" && phone) {
      mem = { at: Date.now(), number: phone };
      // fire-and-forget cache write
      writeCache(svc, phone).catch(() => {});
      return json({ available: true, official_number: phone, source: "waha" });
    }
    // WAHA not connected — try persistent fallback so a transient disconnect doesn't break the UX
    const fallback = await readCache(svc);
    if (fallback) {
      mem = { at: Date.now(), number: fallback };
      return json({ available: true, official_number: fallback, source: "cache" });
    }
    return json({ available: false, official_number: null, source: "not_connected" });
  } catch {
    const fallback = await readCache(svc);
    if (fallback) return json({ available: true, official_number: fallback, source: "cache" });
    return json({ available: false, official_number: null, source: "error" });
  }
});
