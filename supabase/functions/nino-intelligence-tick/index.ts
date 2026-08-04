// nino-intelligence-tick — reconstrói a inteligência unificada do Nino.
// Determinístico e idempotente: não envia mensagens, apenas materializa itens.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const provided = req.headers.get("x-cron-secret") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";

    if (cronSecret && provided !== cronSecret && !authHeader) {
      return json({ ok: false, error: { code: "unauthorized" } }, 401);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data, error } = await admin.rpc("nino_intelligence_tick");
    if (error) return json({ ok: false, error: { code: "tick_failed", message: error.message } }, 500);

    return json({ ok: true, data });
  } catch (e) {
    return json({ ok: false, error: { code: "unexpected", message: (e as Error).message } }, 500);
  }
});
