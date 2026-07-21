// AgentCore barrel — Subetapa 12.1 (esqueleto).
//
// Nesta fase o core apenas AGRUPA e REEXPORTA helpers puros já usados pelo
// orquestrador atual. Nenhum adapter foi migrado ainda; ambos os canais
// (agent-chat e whatsapp-webhook) continuam com o comportamento prévio.
//
// Próximas subetapas planejadas (.lovable/plan.md §12):
//   12.3 — implementar AgentCore.handleTurn compondo estes módulos.
//   12.4 — cortar whatsapp-webhook para chamar AgentCore.handleTurn.
//   12.5 — cortar agent-chat para chamar AgentCore.handleTurn.
//   12.6 — StateManager mínimo (mudança de assunto / retomada).
//   12.7 — limpeza de código morto.

export { service } from "./service.ts";
export { loadHistory, mapConversationRow, type HistoryTurn } from "./ConversationHistory.ts";
export { buildReceipt, type ReceiptKind } from "./ReceiptBuilder.ts";
export { findPending, type PendingRow } from "./PendingConfirmations.ts";
export { enqueueReply, type EnqueueReplyArgs } from "./OutboundQueue.ts";
