// Export the caller's data. Requires a real authenticated JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

Deno.serve(async (req) => {
  const h = httpContext("user-data-export", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return h.fail("method_not_allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return h.fail("unauthorized", 401);
  const token = authHeader.slice("Bearer ".length);

  const client = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  // Valida o token (assinatura + expiração) no servidor de autenticação.
  const { data: userRes, error: cErr } = await client.auth.getUser(token);
  if (cErr || !userRes?.user) return h.fail("unauthorized", 401);

  const { data, error } = await client.rpc("user_export_data");
  if (error) return h.fail("export_failed", 400, { details: { reason: String(error.message).slice(0, 200) } });

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="meunino_export.json"`,
    },
  });
});
