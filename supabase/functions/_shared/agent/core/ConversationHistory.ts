// Canonical conversation history reader used by AgentCore.
// Extracted from orchestrator.ts (subetapa 12.2). Behavior unchanged.
// Also resolves P5 (agent-chat's fragile .slice(1)) by filtering out
// a specific inbound_id when the caller has already inserted the turn.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type HistoryTurn = { role: "user" | "assistant"; content: string };

/** Map a conversation_messages row (real schema: direction/body_masked) to
 *  the {role, content} shape the LLM expects. */
export function mapConversationRow(
  row: { direction?: string | null; body_masked?: string | null },
): HistoryTurn | null {
  const dir = String(row?.direction ?? "");
  if (dir !== "inbound" && dir !== "outbound") return null;
  const content = String(row?.body_masked ?? "").trim();
  if (!content) return null;
  return { role: dir === "inbound" ? "user" : "assistant", content };
}

export async function loadHistory(
  sb: SupabaseClient,
  conversation_id: string,
  opts: { limit?: number; excludeMessageId?: string | null } = {},
): Promise<HistoryTurn[]> {
  const limit = opts.limit ?? 12;
  let q = sb.from("conversation_messages")
    .select("id, direction, body_masked, created_at")
    .eq("conversation_id", conversation_id)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  const { data } = await q;
  const rows = ((data ?? []) as Array<{ id: string; direction: string; body_masked: string }>);
  const filtered = opts.excludeMessageId
    ? rows.filter(r => r.id !== opts.excludeMessageId)
    : rows;
  return filtered
    .slice(0, limit)
    .reverse()
    .map(mapConversationRow)
    .filter((r): r is HistoryTurn => r !== null);
}
