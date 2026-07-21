// Barrel — Agent Core (Fase 2 + Fase 3).
export { service } from "./service.ts";
export { loadHistory, mapConversationRow, type HistoryTurn } from "./ConversationHistory.ts";
export { buildReceipt, type ReceiptKind } from "./ReceiptBuilder.ts";
export { findPending, type PendingRow } from "./PendingConfirmations.ts";
export { enqueueReply, type EnqueueReplyArgs } from "./OutboundQueue.ts";

// Core pipeline
export { handleTurn, type HandleTurnInput, type HandleTurnResult } from "./AgentCore.ts";
export { resolveSession, touchSession, type AgentSession, type Channel } from "./SessionManager.ts";
export { getState, patchState, clearState, type SessionState } from "./StateManager.ts";
export { routeIntent, type RoutedIntent } from "./IntentRouter.ts";
export {
  evaluate as evaluatePolicy, type PolicyDecision,
  decideTurn, type Decision, type DecisionLabel, type DecisionCtx,
} from "./PolicyEngine.ts";
export {
  plan as planAction, type PlannerResult,
  buildDeterministicPlan, dedupePlan, type Plan, type Step,
} from "./ActionPlanner.ts";
export {
  runToolLoop, runTool, withTimeout, dedupKey,
  type ToolRuntimeOptions, type ToolExecution, type RunToolOptions,
} from "./ToolRuntime.ts";
export { deterministicFallback, type FallbackOutcome } from "./DeterministicFallback.ts";
export {
  validate, validateReply, FRIENDLY_ORCHESTRATOR_ERROR,
  type ValidationAction, type ValidationResult, type ValidationContext,
} from "./ResponseValidator.ts";
export { formatReply, personalizeSystemPrompt } from "./ResponseGenerator.ts";
export { buildSnapshot, type Snapshot360, type ContextRequest } from "./FinancialContext360.ts";
export { createTurnContext, type TurnContext } from "./ContextPipeline.ts";
export {
  createMetrics, timeStage, estimateCost, summarize,
  type TurnMetrics, type StageName,
} from "./Observability.ts";
export { logDecision, buildRecord, type DecisionRecord } from "./DecisionLogger.ts";
export {
  classifyError, isRetryable, friendlyFor, guard, type ErrorClass,
} from "./ErrorRecovery.ts";

// Fase 3 intelligence layer
export {
  remember, recall, touch, forget, consolidate, decay, normalizeKey,
  type MemoryKind, type MemorySource, type MemoryRecord, type MemoryFact,
} from "./MemoryStore.ts";
export {
  loadProfile, recomputeProfile, computeProfile, type UserProfile,
} from "./UserProfile.ts";
export {
  runAllDetectors, rank,
  detectSpike, detectConcentration, detectGrowingCategory,
  detectDuplicates, detectGoalRisk, detectForgottenBills,
  detectUnderusedSubscription, detectSavingOpportunity,
  type Insight, type InsightKind, type InsightSeverity, type DetectorCtx,
} from "./InsightsEngine.ts";
export { buildPlan, type PlanObjective, type FinancialPlan, type Milestone } from "./FinancialPlanner.ts";
export { scanUser, type ProactiveSuggestion } from "./ProactiveEngine.ts";
export {
  loadPreferences, savePreferences, applyPreferencesToPrompt, inferPreferencesFromMemory,
  DEFAULT_PREFS, type Preferences,
} from "./PersonalizationEngine.ts";
export { learnFromTurn, type TurnSignal } from "./LearningLoop.ts";
export { dispatchSuggestions, type DispatchOutcome } from "./NotificationDispatcher.ts";

// Adapters
export { handleWhatsAppTurn, type WhatsAppTurn } from "./adapters/WhatsAppAdapter.ts";
export { handleAppAction, handleAppMessage, type AppTurnResult } from "./adapters/AppAdapter.ts";
