// Barrel — expanded for the unified Agent Core (Fase 1).
// Old exports stay so existing call-sites and tests keep working; new ones
// let downstream code import handleTurn/adapters/state modules directly.
export { service } from "./service.ts";
export { loadHistory, mapConversationRow, type HistoryTurn } from "./ConversationHistory.ts";
export { buildReceipt, type ReceiptKind } from "./ReceiptBuilder.ts";
export { findPending, type PendingRow } from "./PendingConfirmations.ts";
export { enqueueReply, type EnqueueReplyArgs } from "./OutboundQueue.ts";

// Fase 1 additions
export { handleTurn, type HandleTurnInput, type HandleTurnResult } from "./AgentCore.ts";
export { resolveSession, touchSession, type AgentSession, type Channel } from "./SessionManager.ts";
export { getState, patchState, clearState, type SessionState } from "./StateManager.ts";
export { routeIntent, type RoutedIntent } from "./IntentRouter.ts";
export { evaluate as evaluatePolicy, type PolicyDecision } from "./PolicyEngine.ts";
export { plan as planAction, type PlannerResult } from "./ActionPlanner.ts";
export { runToolLoop, type ToolRuntimeOptions } from "./ToolRuntime.ts";
export { deterministicFallback, type FallbackOutcome } from "./DeterministicFallback.ts";
export { validateReply, FRIENDLY_ORCHESTRATOR_ERROR } from "./ResponseValidator.ts";
export { formatReply } from "./ResponseGenerator.ts";
export { buildSnapshot, type Snapshot360, type ContextRequest } from "./FinancialContext360.ts";
export { handleWhatsAppTurn, type WhatsAppTurn } from "./adapters/WhatsAppAdapter.ts";
export { handleAppAction, handleAppMessage, type AppTurnResult } from "./adapters/AppAdapter.ts";
