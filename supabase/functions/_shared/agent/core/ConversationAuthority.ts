// Runtime V3 semantic authority for Nino.
//
// V3 owns natural-language interpretation when `runtime_v3_authority_v1` is
// enabled. The mature V2 execution runtime remains the deterministic executor
// for financial engines, writes, evidence and memory. V2 ConversationBrain is
// retained only as a circuit breaker when V3 cannot emit/bridge a safe contract.
// deno-lint-ignore-file no-explicit-any

import { isEnabled } from "./FeatureFlags.ts";
import {
  interpretConversationTurn as interpretConversationTurnV2,
  type ConversationBrainOutcome,
} from "./ConversationBrain.ts";
import type { CanonicalConversationTurnContract, TurnReference } from "./ConversationTurnContract.ts";
import { interpretSemanticTurnV3 } from "../v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../v3/V3RuntimeBridge.ts";
import type { TurnSpecV3 } from "../v3/TurnSpecV3.ts";

export { dialogueActsFromContract } from "./ConversationBrain.ts";
export type { ConversationTurnContract } from "./ConversationBrain.ts";

const V3_MODEL = "openai/gpt-oss-120b";
type AuthorityInput = Parameters<typeof interpretConversationTurnV2>[0];

function historyText(history: AuthorityInput["history"]): string {
  return (history ?? []).slice(-12).map((turn) => {
    const role = turn.role === "user" ? "Usuário" : "Nino";
    return `${role}: ${String(turn.content ?? "").trim().slice(0, 700)}`;
  }).join("\n").slice(0, 7000);
}

function typedContextText(input: AuthorityInput): string {
  const memory = input.memory;
  const workflow = input.workflow;
  const context = {
    relationship_context: input.user_context ? String(input.user_context).slice(0, 4200) : null,
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

function referenceFromV3(turn: TurnSpecV3): TurnReference | null {
  const ref = turn.references[0] ?? null;
  if (!ref) return null;
  const kind: TurnReference["kind"] = ref.source === "quoted_turn"
    ? "quoted_turn"
    : ref.kind === "result_set_reference"
      ? "previous_result_set"
      : "previous_entity";
  return {
    kind,
    target: ref.target,
    expression: ref.expression,
    status: "resolved",
  };
}

/** Preserve V3's structured anaphora through the transitional V2 executor. */
export function attachV3ReferenceToContract(
  turn: TurnSpecV3,
  contract: CanonicalConversationTurnContract,
): CanonicalConversationTurnContract {
  const reference = referenceFromV3(turn);
  if (!reference) return contract;
  return {
    ...contract,
    reference,
    resolution: { ...contract.resolution, reference: "resolved" },
  };
}

function circuitBreakerTelemetry(
  v3: Awaited<ReturnType<typeof interpretSemanticTurnV3>>,
  fallback: ConversationBrainOutcome,
  reason: string,
): ConversationBrainOutcome["telemetry"] {
  return {
    ...fallback.telemetry,
    model: `v3-circuit-breaker:${reason}:${fallback.telemetry.model}`.slice(0, 180),
    llm_calls: Number(v3.telemetry.llm_calls ?? 0) + Number(fallback.telemetry.llm_calls ?? 0),
    tokens_in: Number(v3.telemetry.tokens_in ?? 0) + Number(fallback.telemetry.tokens_in ?? 0),
    tokens_out: Number(v3.telemetry.tokens_out ?? 0) + Number(fallback.telemetry.tokens_out ?? 0),
    latency_ms: Number(v3.telemetry.latency_ms ?? 0) + Number(fallback.telemetry.latency_ms ?? 0),
  };
}

export async function interpretConversationTurn(input: AuthorityInput): Promise<ConversationBrainOutcome> {
  const authorityEnabled = input.user_id
    ? await isEnabled("runtime_v3_authority_v1", input.user_id).catch(() => false)
    : false;
  if (!authorityEnabled) return await interpretConversationTurnV2(input);

  const v3 = await interpretSemanticTurnV3({
    text: input.text,
    history_text: historyText(input.history),
    context_text: typedContextText(input),
    model: input.model || V3_MODEL,
    provider_override: input.provider_override ?? null,
  });

  if (v3.turn) {
    const bridged = bridgeTurnSpecV3ToRuntime(v3.turn);
    if (bridged.ok) {
      return {
        contract: attachV3ReferenceToContract(v3.turn, bridged.contract),
        telemetry: {
...v3.telemetry,
model: `v3-authority:${v3.telemetry.model}`,
        },
      };
    }
    const reason = `bridge:${bridged.errors.join("+")}`.slice(0, 120);
    console.warn("[ConversationAuthority] V3 bridge rejected; using circuit breaker", reason);
    const fallback = await interpretConversationTurnV2(input);
    return { contract: fallback.contract, telemetry: circuitBreakerTelemetry(v3, fallback, reason) };
  }

  const reason = String(v3.telemetry.error ?? v3.violations.join("+") ?? "contract_unavailable").slice(0, 120);
  console.warn("[ConversationAuthority] V3 unavailable; using circuit breaker", reason);
  const fallback = await interpretConversationTurnV2(input);
  return { contract: fallback.contract, telemetry: circuitBreakerTelemetry(v3, fallback, reason) };
}
