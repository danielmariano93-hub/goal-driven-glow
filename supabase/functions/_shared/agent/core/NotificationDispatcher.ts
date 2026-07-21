// NotificationDispatcher — stub plug point. Turns pending suggestions into
// deliveries. Currently only marks them dispatched (app channel is read
// directly from the DB). Kept isolated so WhatsApp/push can plug later
// without refactoring callers.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type DispatchOutcome = { id: string; channel: string; status: "delivered" | "skipped" | "failed"; reason?: string };

export async function dispatchSuggestions(
  sb: SupabaseClient,
  user_id: string,
  opts: { channel?: "app" | "whatsapp"; max?: number } = {},
): Promise<DispatchOutcome[]> {
  const { data } = await sb.from("pending_proactive_suggestions")
    .select("id, channel_ready, kind, title, body, severity")
    .eq("user_id", user_id).eq("status", "pending")
    .order("created_at", { ascending: true }).limit(opts.max ?? 5);
  const rows = (data as any[] | null) ?? [];
  const results: DispatchOutcome[] = [];
  for (const r of rows) {
    const target = opts.channel ?? "app";
    const allowed = r.channel_ready === "both" || r.channel_ready === target;
    if (!allowed) { results.push({ id: r.id, channel: target, status: "skipped", reason: "channel_not_ready" }); continue; }
    // App: just mark dispatched — the app queries pending_proactive_suggestions directly.
    await sb.from("pending_proactive_suggestions")
      .update({ status: "dispatched", dispatched_at: new Date().toISOString() })
      .eq("id", r.id);
    results.push({ id: r.id, channel: target, status: "delivered" });
  }
  return results;
}
