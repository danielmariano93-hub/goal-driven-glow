// Lookup helper for the single pending confirmation per (conversation,user).
// Extracted from orchestrator.ts (subetapa 12.2). Behavior unchanged.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type PendingRow = {
  id: string;
  kind: string;
  payload: unknown;
  summary_text: string;
  status: string;
  expires_at: string;
  user_id: string;
  conversation_id: string;
};

export async function findPending(
  sb: SupabaseClient,
  conversation_id: string,
  user_id: string,
): Promise<PendingRow | null> {
  const { data } = await sb.from("pending_confirmations")
    .select("id, kind, payload, summary_text, status, expires_at, user_id, conversation_id")
    .eq("conversation_id", conversation_id)
    .eq("user_id", user_id)
    .eq("status", "pending")
    .maybeSingle();
  return (data as PendingRow | null) ?? null;
}
