// Orchestrator — thin shim over AgentCore.handleTurn (Fase 1 concluída).
// Comportamento inalterado: continua sendo o ponto de entrada usado por
// whatsapp-webhook e agent-run; a lógica real vive em core/AgentCore.ts.
// Re-exports preservados para compatibilidade com testes e call-sites.
import { handleTurn, type HandleTurnResult } from "./core/AgentCore.ts";

export {
  service,
  findPending,
  enqueueReply,
  loadHistory,
  mapConversationRow,
  buildReceipt,
  FRIENDLY_ORCHESTRATOR_ERROR,
} from "./core/index.ts";

export type OrchestratorInput = {
  user_id: string;
  conversation_id: string;
  inbound_message_id: string;
  text: string;
  source: "whatsapp" | "simulator";
  to_phone: string;
};

export type OrchestratorResult = {
  reply: string;
  reply_kind: HandleTurnResult["reply_kind"] | "unlinked";
  path: HandleTurnResult["path"];
  draft_id?: string;
  run_id?: string;
  result?: unknown;
};

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const r = await handleTurn({
    user_id: input.user_id,
    conversation_id: input.conversation_id,
    inbound_message_id: input.inbound_message_id,
    text: input.text,
    channel: input.source === "simulator" ? "simulator" : "whatsapp",
    to_phone: input.to_phone,
  });
  return {
    reply: r.reply,
    reply_kind: r.reply_kind,
    path: r.path,
    draft_id: r.draft_id,
    run_id: r.run_id,
    result: r.result,
  };
}
