import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider } from "../_shared/messaging/waha.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { ok: false, status: 401 };
  const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "", {
    global: { headers: { Authorization: auth } },
  });
  const { data: userRes, error } = await supabase.auth.getUser();
  if (error || !userRes.user) return { ok: false, status: 401 };
  const { data: adm } = await supabase.rpc("is_current_user_admin");
  if (adm !== true) return { ok: false, status: 403 };
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

  const provider = getProvider();
  if (!provider.configured) return json({ ok: false, error: "not_configured" }, 503);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date().toISOString();
  const { data: pending } = await supabase
    .from("outbound_messages")
    .select("id, to_phone, body, attempts")
    .eq("status", "queued")
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(10);

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const m of pending ?? []) {
    try {
      const { provider_message_id } = await provider.sendText(m.to_phone as string, m.body as string);
      await supabase.from("outbound_messages").update({
        status: "sent", provider_message_id, attempts: (m.attempts as number) + 1,
      }).eq("id", m.id);
      results.push({ id: m.id as string, ok: true });
    } catch (e) {
      const attempts = (m.attempts as number) + 1;
      const backoffMs = Math.min(60_000 * Math.pow(2, attempts), 30 * 60_000);
      const dead = attempts >= 6;
      await supabase.from("outbound_messages").update({
        status: dead ? "dead" : "queued",
        attempts,
        next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
        last_error: String((e as Error).message).slice(0, 200),
      }).eq("id", m.id);
      results.push({ id: m.id as string, ok: false, error: String((e as Error).message) });
    }
  }
  return json({ processed: results.length, results });
});
