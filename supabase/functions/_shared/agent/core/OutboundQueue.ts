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
  artifact_id?: string | null;
};

export async function enqueueReply(sb: SupabaseClient, args: EnqueueReplyArgs): Promise<void> {
  const row: Record<string, unknown> = {
    user_id: args.user_id,
    to_phone: args.to_phone,
    body: args.body,
    kind: "agent",
    channel: args.source === "simulator" ? "simulator" : "whatsapp",
    idempotency_key: args.idempotency_key,
    inbound_message_id: args.inbound_message_id,
    status: args.source === "simulator" ? "sent" : "queued",
    metadata: { conversation_id: args.conversation_id },
  };
  if (args.artifact_id) row.artifact_id = args.artifact_id;
  const { error } = await sb.from("outbound_messages").insert(row);
  if (error) {
    // Só conflito de idempotência (23505 / om_idem_uniq) é benigno: é retry.
    const code = String((error as { code?: string }).code ?? "");
    const msg = String(error.message ?? "");
    if (code === "23505" || /duplicate key|om_idem_uniq/i.test(msg)) return;
    // Diagnóstico completo: sem code/details a causa raiz ficava invisível.
    console.error("[core/OutboundQueue] enqueueReply failed", JSON.stringify({
      code,
      message: msg.slice(0, 300),
      details: String((error as { details?: string }).details ?? "").slice(0, 300),
      hint: String((error as { hint?: string }).hint ?? "").slice(0, 200),
      source: args.source,
      channel: row.channel,
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      inbound_message_id: args.inbound_message_id,
      has_artifact: Boolean(args.artifact_id),
    }));
    throw new Error(`outbound_insert_failed:${code || "unknown"}`);
  }
}
