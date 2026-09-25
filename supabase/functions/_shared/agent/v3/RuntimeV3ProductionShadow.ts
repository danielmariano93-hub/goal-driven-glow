// Nino Runtime V3 — production shadow runner.
//
// Captures read-only context BEFORE the official V2 turn mutates conversation
// memory. After V2 completes, V2 semantic interpretation and the V3 interpreter
// are replayed against the same immutable snapshot and compared. The only side
// effect is an internal telemetry row.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadHistory, withoutCurrentTurn, type HistoryTurn } from "../core/ConversationHistory.ts";
import { loadConversationMemory, type ConversationMemory } from "../core/ConversationMemory.ts";
import { loadWorkflow, type WriteWorkflow } from "../core/WriteWorkflowManager.ts";
import { loadBrainUserContext } from "../core/BrainUserContext.ts";
import { findPending } from "../core/PendingConfirmations.ts";
import { resolveContinuation } from "../core/ContinuationContract.ts";
import { interpretConversationTurn } from "../core/ConversationBrain.ts";
import { resolveNarrowDeterministicTurn } from "../core/NarrowDeterministicGate.ts";
import { resolveGroundedComparisonFollowup } from "../core/GroundedComparisonFollowup.ts";
import type { ConversationTurnContract } from "../core/ConversationTurnContract.ts";
import { interpretSemanticTurnV3 } from "./SemanticInterpreterV3.ts";
import { adaptConversationTurnContractToV3 } from "./TurnSpecV3Adapter.ts";
import { buildExecutionPlanV3 } from "./CapabilityRegistryV3.ts";
import { semanticSignatureV3, compareSemanticSignaturesV3 } from "./SemanticComparatorV3.ts";
import type { TurnSpecV3 } from "./TurnSpecV3.ts";

const V3_SHADOW_MODEL = "openai/gpt-oss-120b";

export type RuntimeV3ShadowInput = {
  user_id: string;
  conversation_id: string;
  inbound_message_id?: string | null;
  channel: string;
  text: string;
};

export type RuntimeV3OfficialOutcome = {
  path?: string | null;
  reply_kind?: string | null;
  run_id?: string | null;
};

export type RuntimeV3ShadowSnapshot = {
  input: RuntimeV3ShadowInput;
  history: HistoryTurn[];
  memory: ConversationMemory | null;
  workflow: WriteWorkflow | null;
  user_context: string | null;
  has_pending_write: boolean;
};

async function findExistingSessionId(
  sb: SupabaseClient,
  input: RuntimeV3ShadowInput,
): Promise<string | null> {
  const { data, error } = await sb.from("agent_sessions")
    .select("id,expires_at")
    .eq("user_id", input.user_id)
    .eq("channel", input.channel)
    .eq("conversation_id", input.conversation_id)
    .maybeSingle();
  if (error || !data?.id) return null;
  if (data.expires_at && new Date(String(data.expires_at)).getTime() <= Date.now()) return null;
  return String(data.id);
}

function historyText(history: HistoryTurn[]): string {
  return history.slice(-12).map((turn) => {
    const role = turn.role === "user" ? "Usuário" : "Nino";
    return `${role}: ${String(turn.content ?? "").trim().slice(0, 700)}`;
  }).join("\n").slice(0, 7000);
}

function typedContextText(snapshot: RuntimeV3ShadowSnapshot): string {
  const memory = snapshot.memory;
  const workflow = snapshot.workflow;
  const context = {
    relationship_context: snapshot.user_context ? snapshot.user_context.slice(0, 4200) : null,
    conversation_state: memory ? {
      current_topic: memory.current_topic ?? null,
      active_category: memory.active_category ?? null,
      active_merchant: memory.active_merchant ?? null,
      active_period: memory.active_period ?? null,
      comparison_period: memory.comparison_period ?? null,
      awaiting: memory.awaiting ?? null,
      pending_conversation_action: memory.pending_conversation_action ?? null,
      active_references: (memory.references ?? []).filter((ref) => ref.status === "active").slice(-5).map((ref) => ({
        target: ref.target,
        entity_labels: ref.entity_labels,
        source_tool: ref.source?.tool_name ?? null,
      })),
    } : null,
    workflow: workflow ? {
      kind: (workflow as any).kind ?? null,
      status: (workflow as any).status ?? null,
      slots: (workflow as any).slots ?? null,
    } : null,
  };
  return JSON.stringify(context).slice(0, 7000);
}

export async function captureRuntimeV3ShadowSnapshot(
  sb: SupabaseClient,
  input: RuntimeV3ShadowInput,
): Promise<RuntimeV3ShadowSnapshot> {
  const sessionId = await findExistingSessionId(sb, input).catch(() => null);
  const [loadedHistory, memory, workflow, userContext, pending] = await Promise.all([
    loadHistory(sb, input.conversation_id, {
      limit: 16,
      excludeMessageId: input.inbound_message_id ?? undefined,
    }).catch(() => []),
    loadConversationMemory(sb, sessionId).catch(() => null),
    loadWorkflow(sb, { user_id: input.user_id, conversation_id: input.conversation_id }).catch(() => null),
    loadBrainUserContext(sb, input.user_id).catch(() => null),
    findPending(sb as any, input.conversation_id, input.user_id).catch(() => null),
  ]);
  const history = input.channel === "app"
    ? loadedHistory
    : withoutCurrentTurn(loadedHistory, input.text);
  return {
    input,
    history,
    memory,
    workflow,
    user_context: userContext,
    has_pending_write: Boolean(pending),
  };
}

function semanticSubSystems(turn: TurnSpecV3 | null): string[] {
  if (!turn || turn.kind !== "task") return [];
  return buildExecutionPlanV3(turn).tasks.map((item) => item.capability.subsystem);
}

async function replayV2Contract(snapshot: RuntimeV3ShadowSnapshot): Promise<{
  contract: ConversationTurnContract | null;
  model: string;
  error: string | null;
}> {
  const continuation = resolveContinuation({
    text: snapshot.input.text,
    action: snapshot.memory?.pending_conversation_action ?? null,
    hasPendingWrite: snapshot.has_pending_write,
  });
  const text = continuation.continue && continuation.prompt ? continuation.prompt : snapshot.input.text;
  const deterministic = resolveGroundedComparisonFollowup(text, snapshot.memory)
    ?? resolveNarrowDeterministicTurn(text);
  if (deterministic) {
    return { contract: deterministic, model: "deterministic", error: null };
  }
  const outcome = await interpretConversationTurn({
    text,
    history: snapshot.history,
    memory: snapshot.memory,
    workflow: snapshot.workflow,
    user_context: snapshot.user_context,
    model: V3_SHADOW_MODEL,
  });
  return {
    contract: outcome.contract,
    model: outcome.telemetry.model,
    error: outcome.telemetry.error,
  };
}

async function insertShadowRow(sb: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await sb.from("nino_runtime_v3_shadow_evaluations").insert(row);
    if (error && String((error as any)?.code ?? "") !== "23505") {
      console.warn("[RuntimeV3Shadow] telemetry insert failed", String((error as any)?.message ?? error).slice(0, 220));
    }
  } catch (error) {
    console.warn("[RuntimeV3Shadow] telemetry exception", String((error as Error)?.message ?? error).slice(0, 220));
  }
}

export async function evaluateRuntimeV3ProductionShadow(args: {
  sb: SupabaseClient;
  snapshot: RuntimeV3ShadowSnapshot;
  official: RuntimeV3OfficialOutcome;
}): Promise<void> {
  const { snapshot } = args;
  const continuation = resolveContinuation({
    text: snapshot.input.text,
    action: snapshot.memory?.pending_conversation_action ?? null,
    hasPendingWrite: snapshot.has_pending_write,
  });
  const semanticText = continuation.continue && continuation.prompt ? continuation.prompt : snapshot.input.text;

  const [v2, v3] = await Promise.all([
    replayV2Contract(snapshot),
    interpretSemanticTurnV3({
      text: semanticText,
      history_text: historyText(snapshot.history),
      context_text: typedContextText(snapshot),
      model: V3_SHADOW_MODEL,
    }),
  ]);

  const v2Adapted = v2.contract
    ? adaptConversationTurnContractToV3(v2.contract, semanticText)
    : { ok: false as const, turn: null, errors: [v2.error ?? "v2_contract_unavailable"] };
  const v2Turn = v2Adapted.ok ? v2Adapted.turn : null;
  const v3Turn = v3.turn;
  const v2Signature = v2Turn ? semanticSignatureV3(v2Turn) : null;
  const v3Signature = v3Turn ? semanticSignatureV3(v3Turn) : null;
  const comparison = v2Signature && v3Signature
    ? compareSemanticSignaturesV3(v2Signature, v3Signature)
    : null;
  const divergence = [
    ...(v2Adapted.ok ? [] : ["v2_not_representable_in_v3"]),
    ...(v3Turn ? [] : ["v3_contract_unavailable"]),
    ...(comparison?.divergence_reasons ?? []),
  ];

  await insertShadowRow(args.sb, {
    user_id: snapshot.input.user_id,
    conversation_id: snapshot.input.conversation_id,
    inbound_message_id: snapshot.input.inbound_message_id ?? null,
    channel: snapshot.input.channel,
    v2_status: v2.contract ? "replayed" : "error",
    v2_kind: v2Turn?.kind ?? null,
    v2_act: v2Turn?.act ?? null,
    v2_canonical_request: v2Turn?.canonical_request ?? null,
    v2_signature: v2Signature ?? {},
    v2_path: args.official.path ?? null,
    v2_tools: [],
    v2_error: v2.error ?? null,
    v3_status: v3Turn ? "ok" : (v3.telemetry.error?.includes("contract") || v3.violations.length ? "rejected" : "error"),
    v3_kind: v3Turn?.kind ?? null,
    v3_act: v3Turn?.act ?? null,
    v3_canonical_request: v3Turn?.canonical_request ?? null,
    v3_signature: v3Signature ?? {},
    v3_task_families: v3Turn?.kind === "task" ? v3Turn.tasks.map((task) => task.family) : [],
    v3_execution_subsystems: semanticSubSystems(v3Turn),
    v3_model: v3.telemetry.model,
    v3_provider: v3.telemetry.provider,
    v3_latency_ms: v3.telemetry.latency_ms,
    v3_tokens_in: v3.telemetry.tokens_in,
    v3_tokens_out: v3.telemetry.tokens_out,
    v3_error: v3.telemetry.error,
    violations: [...new Set([...(v2Adapted.ok ? [] : v2Adapted.errors), ...v3.violations])],
    same_kind: comparison?.same_kind ?? null,
    same_act: comparison?.same_act ?? null,
    same_task_families: comparison?.same_task_families ?? null,
    same_entities: comparison?.same_entities ?? null,
    same_periods: comparison?.same_periods ?? null,
    semantic_match: comparison?.semantic_match ?? false,
    divergence_reasons: [...new Set(divergence)],
  });
}

export function scheduleRuntimeV3ProductionShadow(args: {
  sb: SupabaseClient;
  snapshot: RuntimeV3ShadowSnapshot;
  official: RuntimeV3OfficialOutcome;
}): void {
  const work = evaluateRuntimeV3ProductionShadow(args).catch((error) => {
    console.warn("[RuntimeV3Shadow] evaluation failed", String((error as Error)?.message ?? error).slice(0, 220));
  });
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") edgeRuntime.waitUntil(work);
  else work.catch(() => undefined);
}
