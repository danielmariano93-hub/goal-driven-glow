// Enqueues WhatsApp messages for a Shared Goal invite.
// Reuses outbound_messages queue — does NOT create a new worker.
// See ../_shared/messaging/sharedGoalInviteEnqueue.ts for the pure helper.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import type { MessagePersona } from "../_shared/agent/messageTemplates.ts";
import {
  enqueueGoalInvite,
  normalizeInvitePhone,
} from "../_shared/messaging/sharedGoalInviteEnqueue.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";

Deno.serve(async (req) => {
  const h = httpContext("shared-goal-notify-invite", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return h.fail("method_not_allowed", 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return h.fail("unauthorized", 401);

  const userSb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userRes } = await userSb.auth.getUser();
  const user = userRes.user;
  if (!user) return h.fail("unauthorized", 401);

  let body: any;
  try { body = await req.json(); } catch { return h.fail("invalid_json", 400); }
  const goalId = String(body?.goal_id ?? "").trim();
  const phoneE164 = normalizeInvitePhone(String(body?.phone_e164 ?? ""));
  if (!goalId || !phoneE164) return h.fail("invalid_input", 400);

  const { data: goal, error: goalErr } = await userSb
    .from("shared_goals")
    .select("id,title,target_amount,owner_user_id")
    .eq("id", goalId)
    .maybeSingle();
  if (goalErr || !goal) return h.fail("goal_not_found", 404);
  if (goal.owner_user_id !== user.id) return h.fail("not_owner", 403);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: owner } = await svc.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const { data: prompt } = await svc.from("agent_prompt_versions")
    .select("structured_config").eq("status", "active").order("version", { ascending: false }).limit(1).maybeSingle();
  const persona = (prompt?.structured_config ?? {}) as MessagePersona;

  try {
    const result = await enqueueGoalInvite(
      { sb: svc, env: { APP_PUBLIC_URL: Deno.env.get("APP_PUBLIC_URL") ?? null }, persona },
      {
        goal_id: goalId,
        owner_user_id: user.id,
        owner_name: String(owner?.display_name ?? "").trim(),
        title: String(goal.title ?? "nossa meta"),
        target_amount: Number(goal.target_amount ?? 0),
        phone_e164: phoneE164,
      },
    );
    return h.ok({ ...result });
  } catch (e) {
    console.error(JSON.stringify({ event: "shared_goal_notify_invite_failed", err: String((e as Error).message).slice(0, 200) }));
    return h.fail("enqueue_failed", 500);
  }
});
