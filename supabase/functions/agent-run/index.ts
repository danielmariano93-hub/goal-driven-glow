// Agent orchestrator entry-point.
// Callers:
//   - internal (from whatsapp-webhook, service-role key)
//   - admin simulator (from the frontend using the user's JWT — requires admin)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { runOrchestrator } from "../_shared/agent/orchestrator.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const isService = auth === `Bearer ${SERVICE_ROLE}`;

  const body = await req.json().catch(() => ({}));
  const {
    user_id, conversation_id, inbound_message_id, text, to_phone,
    source = "whatsapp",
  } = body as Record<string, string>;

  if (!user_id || !conversation_id || !inbound_message_id || !text || !to_phone) {
    return json({ error: "missing_fields" }, 400);
  }

  // Non-service callers must be admin.
  if (!isService) {
    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "", {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin } = await supabase.rpc("is_current_user_admin");
    if (isAdmin !== true) return json({ error: "forbidden" }, 403);
  }

  try {
    const result = await runOrchestrator({
      user_id, conversation_id, inbound_message_id, text, to_phone,
      source: source === "simulator" ? "simulator" : "whatsapp",
    });
    return json({ ok: true, ...result });
  } catch (e) {
    console.error("[agent-run] failure", String((e as Error).message).slice(0, 200));
    return json({ error: "internal" }, 500);
  }
});
