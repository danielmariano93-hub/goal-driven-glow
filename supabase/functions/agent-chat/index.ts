// In-app assessor chat — thin HTTP wrapper.
// Auth, rate limit, conversation lifecycle and JSON contract live here; every
// message-level decision is delegated to core/adapters/AppAdapter, so App and
// WhatsApp go through the exact same pipeline (Fase 1 — Agent Core unificado).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { handleAppAction, handleAppMessage } from "../_shared/agent/core/adapters/AppAdapter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_MSG_LEN = 2000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
  const user_id = userRes.user.id;

  const body = await req.json().catch(() => ({}));
  const rawText = String(body?.text ?? "").trim();
  const action = String(body?.action ?? "").trim(); // "confirm" | "cancel" | ""
  const pendingId = typeof body?.pending_id === "string" ? body.pending_id : null;
  const requested_conv = typeof body?.conversation_id === "string" ? body.conversation_id : null;
  const text = rawText.slice(0, MAX_MSG_LEN);
  if (!text && !action) return json({ error: "missing_text" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // Simple rate limit: 40 msgs/min per user for app source
  const { count } = await svc
    .from("conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user_id)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) > 40) return json({ error: "rate_limited" }, 429);

  // Get or create app conversation
  let conversation_id = requested_conv;
  if (conversation_id) {
    const { data: conv } = await svc.from("conversations")
      .select("id, user_id, source")
      .eq("id", conversation_id).maybeSingle();
    if (!conv || (conv as any).user_id !== user_id || (conv as any).source !== "app") conversation_id = null;
  }
  if (!conversation_id) {
    const { data: newConv, error: convErr } = await svc.from("conversations")
      .insert({ user_id, source: "app", phone_e164: null, last_message_at: new Date().toISOString() } as any)
      .select("id").single();
    if (convErr) return json({ error: "conv_create_failed" }, 500);
    conversation_id = (newConv as any)!.id as string;
  }

  try {
    if (action === "confirm" || action === "cancel") {
      const out = await handleAppAction({ user_id, conversation_id, action: action as "confirm" | "cancel", pending_id: pendingId });
      return json({ ok: true, conversation_id, ...out });
    }
    const out = await handleAppMessage({ user_id, conversation_id, text });
    return json({ ok: true, conversation_id, ...out });
  } catch (e) {
    console.error("[agent-chat] handler failed", String((e as Error).message).slice(0, 200));
    return json({ error: "internal" }, 500);
  }
});
