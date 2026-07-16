// Edge Function: assistant-review-actions
// POST body:
//   { action:'list', document_id }
//   { action:'update', item_id, patch:{...} }
//   { action:'ignore', item_id }
//   { action:'confirm', document_id, item_ids:[...] }
//   { action:'cancel', document_id }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_PATCH_KEYS = new Set([
  "description", "amount", "occurred_at", "category_id", "account_id",
  "credit_card_id", "payment_method", "installments_total", "installment_number",
  "purchase_date", "competence_date", "status",
]);

async function getUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error) return null;
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  // Impersonate the user for RLS-scoped calls (RPCs use auth.uid()).
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = String(body.action ?? "");

  if (action === "list") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return json({ error: "missing_document_id" }, 400);
    const { data: doc } = await sb.from("document_imports").select("*").eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!doc) return json({ error: "not_found" }, 404);
    const { data: items } = await sb.from("extracted_items").select("*").eq("document_id", document_id).eq("user_id", user.id).order("idx");
    return json({ ok: true, document: doc, items: items ?? [] });
  }

  if (action === "update") {
    const item_id = String(body.item_id ?? "");
    const patch = (body.patch ?? {}) as Record<string, unknown>;
    if (!item_id) return json({ error: "missing_item_id" }, 400);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!ALLOWED_PATCH_KEYS.has(k)) continue;
      clean[k] = v;
    }
    if (Object.keys(clean).length === 0) return json({ error: "empty_patch" }, 400);
    // ownership enforced by RLS via user JWT
    const { data, error } = await sb.from("extracted_items").update(clean).eq("id", item_id).eq("user_id", user.id).select().maybeSingle();
    if (error) return json({ error: "update_failed", details: error.message }, 400);
    if (!data) return json({ error: "not_found" }, 404);
    return json({ ok: true, item: data });
  }

  if (action === "ignore") {
    const item_id = String(body.item_id ?? "");
    if (!item_id) return json({ error: "missing_item_id" }, 400);
    const { data, error } = await sb.from("extracted_items").update({ status: "ignored" }).eq("id", item_id).eq("user_id", user.id).select().maybeSingle();
    if (error) return json({ error: "update_failed", details: error.message }, 400);
    if (!data) return json({ error: "not_found" }, 404);
    return json({ ok: true, item: data });
  }

  if (action === "confirm") {
    const document_id = String(body.document_id ?? "");
    const item_ids = Array.isArray(body.item_ids) ? (body.item_ids as string[]) : [];
    if (!document_id || item_ids.length === 0) return json({ error: "missing_fields" }, 400);
    const { data, error } = await userClient.rpc("confirm_document_import", {
      p_document_id: document_id, p_item_ids: item_ids,
    });
    if (error) return json({ error: "rpc_failed", details: error.message }, 400);
    return json({ ok: true, result: data });
  }

  if (action === "cancel") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return json({ error: "missing_document_id" }, 400);
    const { data, error } = await userClient.rpc("cancel_document_import", { p_document_id: document_id });
    if (error) return json({ error: "rpc_failed", details: error.message }, 400);
    return json({ ok: true, result: data });
  }

  return json({ error: "unknown_action" }, 400);
});
