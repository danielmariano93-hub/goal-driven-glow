// Enqueues WhatsApp messages for a Shared Goal invite.
// Reuses outbound_messages queue — does NOT create a new worker.
// - Immediate `goal_invite` (queued, next_attempt_at=now).
// - Followup `goal_invite_followup` scheduled +72h.
// - Idempotency keys are stable, so retries never duplicate.
// - Registered phones receive deep link; guests receive signup with `next`.
// - Non-blocking: main invite (RPC) is created by the frontend BEFORE this call.
//   Errors here are observable but never rolled back client-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { renderMessageTemplate, buildLinkSentence, type MessagePersona } from "../_shared/agent/messageTemplates.ts";
import { buildSharedGoalUrl, buildSignupUrl } from "../_shared/messaging/appUrl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const FOLLOWUP_HOURS = 72;

function normalizePhone(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  return s.startsWith("+") ? s : `+${s.replace(/[^\d]/g, "")}`;
}

export type EnqueueDeps = {
  sb: any;
  env: { APP_PUBLIC_URL?: string | null };
  persona: MessagePersona;
  now?: Date;
};

/** Pure enqueue helper — exported for tests. */
export async function enqueueGoalInvite(
  deps: EnqueueDeps,
  input: {
    goal_id: string;
    owner_user_id: string;
    owner_name: string;
    title: string;
    target_amount: number;
    phone_e164: string;
    participant_name?: string | null;
  },
): Promise<{ immediate_id: string | null; followup_id: string | null; registered: boolean; skipped?: string }> {
  const phone = normalizePhone(input.phone_e164);
  if (!phone) return { immediate_id: null, followup_id: null, registered: false, skipped: "no_phone" };

  // Detect registered phone via whatsapp_links.
  const { data: link } = await deps.sb
    .from("whatsapp_links")
    .select("user_id")
    .eq("phone_e164", phone)
    .eq("status", "active")
    .maybeSingle();
  const isRegistered = !!link?.user_id;

  const appLink = buildSharedGoalUrl(deps.env, input.goal_id, { ref: "wa_goal" });
  const signupLink = buildSignupUrl(deps.env, {
    ref: "wa_goal",
    phone,
    next: `/app/metas-conjuntas/${input.goal_id}`,
  });
  const linkSentence = buildLinkSentence({ isRegistered, appLink, signupLink });

  const amount = `R$ ${Number(input.target_amount || 0).toFixed(2).replace(".", ",")}`;
  const values = {
    participant_name: String(input.participant_name ?? "").trim() || "tudo bem",
    owner_name: String(input.owner_name ?? "").trim() || "quem te convidou",
    title: input.title,
    amount,
    link_sentence: linkSentence,
  };

  const bodyInvite = renderMessageTemplate("goal_invite", deps.persona, values);
  const bodyFollowup = renderMessageTemplate("goal_invite_followup", deps.persona, values);
  const now = deps.now ?? new Date();
  const followupAt = new Date(now.getTime() + FOLLOWUP_HOURS * 3600 * 1000);

  const rows = [
    {
      idempotency_key: `goal_invite:${input.goal_id}:${phone}`,
      body: bodyInvite,
      kind: "goal_invite",
      next_attempt_at: now.toISOString(),
      metadata: { origin: "shared_goal_invite", template: "goal_invite", registered: isRegistered },
    },
    {
      idempotency_key: `goal_invite_followup:${input.goal_id}:${phone}`,
      body: bodyFollowup,
      kind: "goal_invite_followup",
      next_attempt_at: followupAt.toISOString(),
      metadata: { origin: "shared_goal_invite", template: "goal_invite_followup", registered: isRegistered },
    },
  ];

  const out: { immediate_id: string | null; followup_id: string | null } = {
    immediate_id: null,
    followup_id: null,
  };
  for (const row of rows) {
    const insertRow = {
      channel: "whatsapp",
      user_id: input.owner_user_id,
      to_phone: phone,
      body: row.body,
      status: "queued",
      kind: row.kind,
      idempotency_key: row.idempotency_key,
      context_type: "shared_goal",
      context_id: input.goal_id,
      next_attempt_at: row.next_attempt_at,
      metadata: row.metadata,
    };
    const { data, error } = await deps.sb
      .from("outbound_messages")
      .insert(insertRow)
      .select("id")
      .single();
    if (error) {
      const msg = String(error.message ?? "");
      const dupe = /duplicate|unique/i.test(msg) || String((error as any).code) === "23505";
      if (dupe) {
        const { data: existing } = await deps.sb
          .from("outbound_messages")
          .select("id")
          .eq("idempotency_key", row.idempotency_key)
          .maybeSingle();
        if (row.kind === "goal_invite") out.immediate_id = existing?.id ?? null;
        else out.followup_id = existing?.id ?? null;
      } else {
        throw new Error(`enqueue_failed:${row.kind}:${msg.slice(0, 120)}`);
      }
    } else {
      if (row.kind === "goal_invite") out.immediate_id = data.id;
      else out.followup_id = data.id;
    }
  }

  return { ...out, registered: isRegistered };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userSb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userRes } = await userSb.auth.getUser();
  const user = userRes.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const goalId = String(body?.goal_id ?? "").trim();
  const phoneE164 = normalizePhone(String(body?.phone_e164 ?? ""));
  if (!goalId || !phoneE164) return json({ error: "invalid_input" }, 400);

  // Validate ownership using caller's JWT (RLS). shared_goals owner_user_id must match.
  const { data: goal, error: goalErr } = await userSb
    .from("shared_goals")
    .select("id,title,target_amount,owner_user_id")
    .eq("id", goalId)
    .maybeSingle();
  if (goalErr || !goal) return json({ error: "goal_not_found" }, 404);
  if (goal.owner_user_id !== user.id) return json({ error: "not_owner" }, 403);

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
    return json({ ok: true, ...result });
  } catch (e) {
    console.error(JSON.stringify({ event: "shared_goal_notify_invite_failed", err: String((e as Error).message).slice(0, 200) }));
    return json({ ok: false, error: "enqueue_failed" }, 500);
  }
});
