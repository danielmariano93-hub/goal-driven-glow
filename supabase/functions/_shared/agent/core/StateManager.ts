// StateManager — reads/writes structured jsonb state on the active session.
// Keeps the Core independent of the conversation history: intent slots,
// last draft id, current flow cursor, etc. are stored here so the agent
// doesn't need to re-derive them from raw messages every turn.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type SessionState = Record<string, unknown>;

export async function getState(sb: SupabaseClient, sessionId: string): Promise<SessionState> {
  const { data } = await sb.from("agent_sessions").select("state").eq("id", sessionId).maybeSingle();
  return (((data as any)?.state as SessionState | null) ?? {}) as SessionState;
}

export async function patchState(
  sb: SupabaseClient,
  sessionId: string,
  patch: SessionState,
): Promise<void> {
  const current = await getState(sb, sessionId);
  const next = { ...current, ...patch };
  await sb.from("agent_sessions").update({ state: next }).eq("id", sessionId);
}

export async function clearState(sb: SupabaseClient, sessionId: string): Promise<void> {
  await sb.from("agent_sessions").update({ state: {} }).eq("id", sessionId);
}
