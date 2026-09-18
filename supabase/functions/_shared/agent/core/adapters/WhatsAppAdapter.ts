// WhatsAppAdapter — translates a WhatsApp/simulator turn into the shared
// rollout-gated Conversation Architecture V2 entrypoint. When the V2 flag is
// off, AgentCoreV2 delegates to the legacy AgentCore with no behavior change.
import { handleTurnV2 } from "../AgentCoreV2Entry.ts";
import type { HandleTurnResult } from "../AgentCore.ts";

export type WhatsAppTurn = {
  user_id: string;
  conversation_id: string;
  inbound_message_id: string;
  text: string;
  to_phone: string;
  source?: "whatsapp" | "simulator";
  reply_context?: { quoted_message_id?: string | null; amount_hint?: number | null } | null;
};

export async function handleWhatsAppTurn(input: WhatsAppTurn): Promise<HandleTurnResult> {
  return await handleTurnV2({
    user_id: input.user_id,
    conversation_id: input.conversation_id,
    inbound_message_id: input.inbound_message_id,
    text: input.text,
    channel: input.source === "simulator" ? "simulator" : "whatsapp",
    to_phone: input.to_phone,
    reply_context: input.reply_context ?? null,
  });
}
