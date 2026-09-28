// Runtime V3 semantic authority for Nino.
//
// When runtime_v3_authority_v1 is enabled, natural-language meaning is owned by
// one semantic contract only: TurnSpecV3. Downstream components may validate,
// ground and execute that meaning, but they never reinterpret the sentence.
// Legacy V2 remains available only for users outside the V3 rollout.
// deno-lint-ignore-file no-explicit-any

import { isEnabled } from "./FeatureFlags.ts";
import {
  interpretConversationTurn as interpretConversationTurnV2,
  type ConversationBrainOutcome,
} from "./ConversationBrain.ts";
import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
  type TurnReference,
} from "./ConversationTurnContract.ts";
import { interpretWithSingleSemanticAuthorityV3 } from "../v3/SemanticAuthorityV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../v3/V3RuntimeBridge.ts";
import type { TurnSpecV3 } from "../v3/TurnSpecV3.ts";

export { dialogueActsFromContract } from "./ConversationBrain.ts";
export type { ConversationTurnContract } from "./ConversationBrain.ts";

type AuthorityInput = Parameters<typeof interpretConversationTurnV2>[0];

type SemanticTelemetry = ConversationBrainOutcome["telemetry"];

function historyText(history: AuthorityInput["history"]): string {
  return (history ?? []).slice(-14).map((turn) => {
    const role = turn.role === "user" ? "Usuário" : "Nino";
    return `${role}: ${String(turn.content ?? "").trim().slice(0, 650)}`;
  }).join("\n").slice(0, 7200);
}

/**
 * Context is evidence ABOUT the conversation, never a second semantic parser.
 * The brain receives enough state to resolve ellipsis/anaphora naturally while
 * financial truth still comes only from domain engines after grounding.
 */
function typedContextText(input: AuthorityInput): string {
  const memory = input.memory;
  const workflow = input.workflow;
  const context = {
    relationship_context: input.user_context ? String(input.user_context).slice(0, 4200) : null,
    conversation_state: memory ? {
      current_topic: memory.current_topic ?? null,
      conversation_summary: memory.conversation_summary ?? null,
      active_topic_id: memory.active_topic_id ?? null,
      previous_intent: memory.previous_intent ?? null,
      active_category: memory.active_category ?? null,
      active_merchant: memory.active_merchant ?? null,
      active_period: memory.active_period ?? null,
      comparison_period: memory.comparison_period ?? null,
      awaiting: memory.awaiting ?? null,
      pending_conversation_action: memory.pending_conversation_action ?? null,
      last_tool_context: memory.last_tool_context ?? null,
      last_analysis: memory.last_analysis ?? null,
      active_references: (memory.references ?? [])
        .filter((ref) => ref.status === "active")
        .slice(-6)
        .map((ref) => ({
          target: ref.target,
          entity_labels: ref.entity_labels,
          source_tool: ref.source?.tool_name ?? null,
          query_id: ref.source?.query_id ?? null,
        })),
    } : null,
    workflow: workflow ? {
      kind: (workflow as any).kind ?? null,
      status: (workflow as any).status ?? null,
      slots: (workflow as any).slots ?? null,
    } : null,
  };
  return JSON.stringify(context).slice(0, 9000);
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

/** Preserve V3 structured anaphora through the transitional V2 executor. */
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

export function isProviderCapacityFailure(reason: unknown): boolean {
  return /(?:structured_call_gateway_429|\b429\b|rate\s*limit|too\s+many\s+requests|structured_call_network|gateway_(?:500|502|503|504))/i
    .test(String(reason ?? ""));
}

function fallbackTelemetry(base: SemanticTelemetry | null, reason: string): SemanticTelemetry {
  return {
    model: String(base?.model ?? "v3-semantic-unavailable").slice(0, 180),
    provider: base?.provider ?? null,
    llm_calls: Number(base?.llm_calls ?? 0),
    tokens_in: Number(base?.tokens_in ?? 0),
    tokens_out: Number(base?.tokens_out ?? 0),
    latency_ms: Number(base?.latency_ms ?? 0),
    ok: false,
    error: reason,
  };
}

function humanCapacityFallback(
  input: AuthorityInput,
  reason: string,
  telemetry: SemanticTelemetry | null,
): ConversationBrainOutcome {
  const contract = normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "answer",
    mode: "converse",
    domain: "conversation",
    canonical_request: String(input.text ?? "").trim() || null,
    inherit_focus: true,
    focus: {
      category: input.memory?.active_category ?? null,
      merchant: input.memory?.active_merchant ?? null,
      goal: null,
      period_expression: null,
      period_expressions: [],
    },
    action: null,
    direct_reply: "Não consegui fechar isso agora. Me manda a mesma mensagem de novo daqui a pouco?",
    clarification_question: null,
    resolution: {
      intent: "resolved", reference: "not_applicable", time: "not_applicable",
      entity: "not_applicable", action: "not_applicable",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  });
  return { contract, telemetry: fallbackTelemetry(telemetry, reason) };
}

function humanSemanticClarification(
  input: AuthorityInput,
  reason: string,
  telemetry: SemanticTelemetry | null,
): ConversationBrainOutcome {
  const contract = normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "repair",
    mode: "clarify",
    domain: "conversation",
    canonical_request: String(input.text ?? "").trim() || null,
    inherit_focus: true,
    focus: {
      category: input.memory?.active_category ?? null,
      merchant: input.memory?.active_merchant ?? null,
      goal: null,
      period_expression: null,
      period_expressions: [],
    },
    action: null,
    direct_reply: null,
    clarification_question: "Quero ter certeza de que entendi antes de seguir. Pode me dizer em uma frase o que você quer que eu faça?",
    resolution: {
      intent: "ambiguous", reference: "not_applicable", time: "not_applicable",
      entity: "not_applicable", action: "ambiguous",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  });
  return { contract, telemetry: fallbackTelemetry(telemetry, reason) };
}

export async function interpretConversationTurn(input: AuthorityInput): Promise<ConversationBrainOutcome> {
  const authorityEnabled = input.user_id
    ? await isEnabled("runtime_v3_authority_v1", input.user_id).catch(() => false)
    : false;

  // Users outside the rollout keep the legacy brain. Once V3 is authoritative,
  // no lexical fast-path, parser or V2 circuit breaker may decide meaning first.
  if (!authorityEnabled) return await interpretConversationTurnV2(input);

  const semantic = await interpretWithSingleSemanticAuthorityV3({
    text: input.text,
    history_text: historyText(input.history),
    context_text: typedContextText(input),
    deep_model: input.model ?? null,
    provider_override: input.provider_override ?? null,
  });

  if (semantic.turn) {
    const bridged = bridgeTurnSpecV3ToRuntime(semantic.turn);
    if (bridged.ok) {
      return {
        contract: attachV3ReferenceToContract(semantic.turn, bridged.contract),
        telemetry: {
          ...semantic.telemetry,
          model: `v3-${semantic.tier}:${semantic.telemetry.model}`.slice(0, 180),
        },
      };
    }

    // Bridge failure means execution cannot represent the meaning safely. Do
    // not invoke another language interpreter to invent a different meaning.
    const reason = `v3_bridge_rejected:${bridged.errors.join("+")}`.slice(0, 220);
    console.warn("[ConversationAuthority] semantic contract cannot be represented", reason);
    return humanSemanticClarification(input, reason, semantic.telemetry);
  }

  const reason = String(
    semantic.telemetry.error
      ?? semantic.review_reasons.join("+")
      ?? semantic.violations.join("+")
      ?? "semantic_authority_unavailable",
  ).slice(0, 220);
  console.warn("[ConversationAuthority] semantic authority unavailable", reason);

  if (isProviderCapacityFailure(reason)) {
    return humanCapacityFallback(input, reason, semantic.telemetry);
  }
  return humanSemanticClarification(input, reason, semantic.telemetry);
}
