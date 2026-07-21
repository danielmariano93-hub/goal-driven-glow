// WhatsAppAdapter — translates a WhatsApp/simulator turn into the shared
// AgentCore.handleTurn call. Keeps the webhook thin: it stays in charge of
// dedupe, ACKs, media fallback and linking; message-level orchestration is
// entirely inside AgentCore.
import { handleTurn, type HandleTurnResult } from "../AgentCore.ts";

export type WhatsAppTurn = {
  user_id: string;
  conversation_id: string;
  inbound_message_id: string;
  text: string;
  to_phone: string;
  source?: "whatsapp" | "simulator";
};

export async function handleWhatsAppTurn(input: WhatsAppTurn): Promise<HandleTurnResult> {
  return await handleTurn({
    user_id: input.user_id,
    conversation_id: input.conversation_id,
    inbound_message_id: input.inbound_message_id,
    text: input.text,
    channel: input.source === "simulator" ? "simulator" : "whatsapp",
    to_phone: input.to_phone,
  });
}
