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
  const { data: conv } = await sb.from("conversations")
    .select("user_id, phone_e164")
    .eq("id", conversation_id)
    .maybeSingle();

  const q = sb.from("conversation_messages")
    .select("id, direction, body_masked, created_at")
    .eq("conversation_id", conversation_id)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  const outboundPromise = conv
    ? sb.from("outbound_messages")
      .select("id, body, created_at, channel, to_phone")
      .eq("user_id", (conv as any).user_id)
      .eq("to_phone", (conv as any).phone_e164)
      .neq("channel", "inapp")
      .order("created_at", { ascending: false })
      .limit(limit + 1)
    : Promise.resolve({ data: [] as any[] });

  const [{ data }, { data: outbound }] = await Promise.all([q, outboundPromise]);
  const rows = ((data ?? []) as Array<{ id: string; direction: string; body_masked: string; created_at: string }>)
    .map(r => ({ id: r.id, role: r.direction === "inbound" ? "user" as const : "assistant" as const, content: r.body_masked, created_at: r.created_at }));
  const directOutbound = ((outbound ?? []) as Array<{ id: string; body: string; created_at: string }>)
    .map(r => ({ id: `outbound:${r.id}`, role: "assistant" as const, content: r.body, created_at: r.created_at }));
  const filtered = opts.excludeMessageId
    ? [...rows, ...directOutbound].filter(r => r.id !== opts.excludeMessageId)
    : [...rows, ...directOutbound];
  return filtered
    .filter(r => String(r.content ?? "").trim())
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-limit)
    .map(r => ({ role: r.role, content: String(r.content).trim() }));
}
