// WhatsApp/simulator outbound queue helper.
// Extracted from orchestrator.ts (subetapa 12.2). Behavior unchanged.
// The App adapter does NOT use this — it replies over HTTP.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type EnqueueReplyArgs = {
  user_id: string;
  conversation_id: string;
  to_phone: string;
  body: string;
  idempotency_key: string;
  inbound_message_id: string;
  source: "whatsapp" | "simulator";
};

export async function enqueueReply(sb: SupabaseClient, args: EnqueueReplyArgs): Promise<void> {
  const { error } = await sb.from("outbound_messages").insert({
    user_id: args.user_id,
    to_phone: args.to_phone,
    body: args.body,
    kind: "agent",
    channel: args.source === "simulator" ? "simulator" : "whatsapp",
    idempotency_key: args.idempotency_key,
    inbound_message_id: args.inbound_message_id,
    status: args.source === "simulator" ? "sent" : "queued",
    metadata: { conversation_id: args.conversation_id },
  });
  if (error) {
    // Duplicate idempotency_key is safe to ignore (retry path).
    const msg = String(error.message ?? "");
    if (!/duplicate|unique/i.test(msg)) {
      console.error("[core/OutboundQueue] enqueueReply failed", msg.slice(0, 200));
      throw new Error("outbound_insert_failed");
    }
  }
}
