/* eslint-disable @typescript-eslint/no-explicit-any */
// Pure helper (no Deno dependencies) for enqueueing WhatsApp goal invites.
// Reused by the shared-goal-notify-invite edge function and by tests.
import { renderMessageTemplate, buildLinkSentence, type MessagePersona } from "../agent/messageTemplates.ts";
import { buildSharedGoalUrl, buildSignupUrl } from "./appUrl.ts";

const FOLLOWUP_HOURS = 72;

export function normalizeInvitePhone(raw: string): string {
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

export type EnqueueInput = {
  goal_id: string;
  owner_user_id: string;
  owner_name: string;
  title: string;
  target_amount: number;
  phone_e164: string;
  participant_name?: string | null;
};

export type EnqueueResult = {
  immediate_id: string | null;
  followup_id: string | null;
  registered: boolean;
  skipped?: string;
};

export async function enqueueGoalInvite(deps: EnqueueDeps, input: EnqueueInput): Promise<EnqueueResult> {
  const phone = normalizeInvitePhone(input.phone_e164);
  if (!phone) return { immediate_id: null, followup_id: null, registered: false, skipped: "no_phone" };

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

  const out: EnqueueResult = { immediate_id: null, followup_id: null, registered: isRegistered };
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

  return out;
}
