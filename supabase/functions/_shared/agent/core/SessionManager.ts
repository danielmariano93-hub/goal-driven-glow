// SessionManager — per-(user, channel) session lifecycle.
// Backed by public.agent_sessions (see migration
// 20260721_agent_sessions.sql). TTL is enforced by expires_at; expired rows
// are transparently re-created with fresh state.
//
// The session id is stable across turns as long as the user stays active on
// the same channel. Storage is intentionally minimal: identity + activity
// timestamps + jsonb state used by StateManager.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type Channel = "whatsapp" | "simulator" | "app";

export type AgentSession = {
  id: string;
  user_id: string;
  channel: Channel;
  conversation_id: string;
  state: Record<string, unknown>;
  last_activity_at: string;
  expires_at: string;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min inactivity

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export async function resolveSession(
  sb: SupabaseClient,
  args: { user_id: string; channel: Channel; conversation_id: string; ttlMs?: number },
): Promise<AgentSession> {
  const ttl = args.ttlMs ?? DEFAULT_TTL_MS;
  const nowIso = new Date().toISOString();

  const { data: existing } = await sb.from("agent_sessions")
    .select("id, user_id, channel, conversation_id, state, last_activity_at, expires_at")
    .eq("user_id", args.user_id)
    .eq("channel", args.channel)
    .maybeSingle();

  if (existing && new Date((existing as any).expires_at as string).getTime() > Date.now()) {
    const patch = {
      conversation_id: args.conversation_id,
      last_activity_at: nowIso,
      expires_at: isoIn(ttl),
    };
    await sb.from("agent_sessions").update(patch).eq("id", (existing as any).id);
    return { ...(existing as any), ...patch } as AgentSession;
  }

  // Expired or missing → recreate with fresh state.
  if (existing) {
    await sb.from("agent_sessions").delete().eq("id", (existing as any).id);
  }
  const row = {
    user_id: args.user_id,
    channel: args.channel,
    conversation_id: args.conversation_id,
    state: {},
    last_activity_at: nowIso,
    expires_at: isoIn(ttl),
  };
  const { data: created } = await sb.from("agent_sessions")
    .insert(row).select("id, user_id, channel, conversation_id, state, last_activity_at, expires_at")
    .maybeSingle();
  // If insert failed (race), fall back to a synthetic in-memory session so
  // the turn still runs. Persistence is best-effort by design.
  if (!created) {
    return { id: crypto.randomUUID(), ...row } as AgentSession;
  }
  return created as AgentSession;
}

export async function touchSession(
  sb: SupabaseClient,
  sessionId: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  await sb.from("agent_sessions").update({
    last_activity_at: new Date().toISOString(),
    expires_at: isoIn(ttlMs),
  }).eq("id", sessionId);
}
