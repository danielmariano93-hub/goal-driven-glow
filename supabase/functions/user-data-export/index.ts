// Export the caller's data. Requires a real authenticated JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const token = authHeader.slice("Bearer ".length);

  const client = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  // Validate token via getClaims (verifies signature + expiration).
  const { data: claims, error: cErr } = await client.auth.getClaims(token);
  if (cErr || !claims?.claims) return json({ error: "unauthorized" }, 401);

  const { data, error } = await client.rpc("user_export_data");
  if (error) return json({ error: error.message }, 400);

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="nocontrole_export.json"`,
    },
  });
});
