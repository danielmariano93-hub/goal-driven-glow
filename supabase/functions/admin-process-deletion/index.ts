// Admin-only endpoint that finalizes an approved account_deletion_request.
// Uses service role to run the SECURITY DEFINER RPC (which enforces the
// approved → grace-elapsed → completed transition) and then removes the
// auth.users row via the admin API.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  // Verify admin via user JWT.
  const userClient = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userRes } = await userClient.auth.getUser();
  if (!userRes.user) return json({ error: "unauthorized" }, 401);
  const { data: isAdmin } = await userClient.rpc("is_current_user_admin");
  if (isAdmin !== true) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, string>));
  const requestId = body.request_id;
  if (!requestId) return json({ error: "missing request_id" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: deletedUserId, error: procErr } = await admin.rpc("admin_process_deletion_request", {
    p_id: requestId,
  });
  if (procErr) return json({ error: procErr.message }, 400);

  if (deletedUserId) {
    const { error: authErr } = await admin.auth.admin.deleteUser(deletedUserId as string);
    if (authErr) {
      console.error("auth.admin.deleteUser failed", authErr.message);
      return json({ ok: true, warning: "data_deleted_but_auth_user_remains", detail: authErr.message });
    }
  }
  return json({ ok: true, deleted_user_id: deletedUserId });
});
