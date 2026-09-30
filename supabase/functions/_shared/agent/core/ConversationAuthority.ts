// Runtime V3 semantic authority for Nino.
//
// Natural-language meaning is owned by TurnSpecV3. Downstream components may
// validate, ground and execute that meaning, but they never reinterpret it.
// no lexical fast-path, parser or V2 circuit breaker may decide meaning first.
// deno-lint-ignore-file no-explicit-any

import { repairDailyGrainInContract } from "./DailyGrainRepair.ts";
import { isEnabled } from "./FeatureFlags.ts";
import type { ConversationBrainInput, ConversationBrainOutcome } from "./ConversationBrain.ts";
import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
  type TurnReference,
} from "./ConversationTurnContract.ts";
import { trustedActivePeriod } from "./ConversationMemory.ts";
import { interpretWithSingleSemanticAuthorityV3 } from "../v3/SemanticAuthorityV3.ts";
import { bridgeTurnSpecV3ToRuntime, bridgeTurnSpecV3ToRuntimePlan } from "../v3/V3RuntimeBridge.ts";
import type { TurnSpecV3 } from "../v3/TurnSpecV3.ts";

export { dialogueActsFromContract } from "./ConversationBrain.ts";
export type { ConversationTurnContract } from "./ConversationBrain.ts";

type AuthorityInput = ConversationBrainInput;
type SemanticTelemetry = ConversationBrainOutcome["telemetry"];

function historyText(history: AuthorityInput["history"]): string {
  // Recent dialogue is nuance, not truth. Keep only the latest turns; durable
  // structured state below carries references and evidence-backed scope.
  return (history ?? []).slice(-8).map((turn) => {
    const role = turn.role === "user" ? "Usuário" : "Nino";
    return `${role}: ${String(turn.content ?? "").trim().slice(0, 520)}`;
  }).join("\n").slice(0, 4300);
}

/**
 * Structured context supplied to the semantic authority. The precedence policy
 * is explicit so the model never has to infer which memory source wins.
 */
function typedContextText(input: AuthorityInput): string {
  const memory = input.memory;
  const workflow = input.workflow;
  const trustedPeriod = trustedActivePeriod(memory);
  const context = {
    precedence_policy: [
      "current_turn",
      "quoted_turn",
      "pending_workflow",
      "active_reference",
      "evidence_backed_state",
      "conversation_state",
      "relationship_memory",
    ],
    relationship_context: input.user_context ? String(input.user_context).slice(0, 3200) : null,
    conversation_state: memory ? {
      current_topic: memory.current_topic ?? null,
      conversation_summary: memory.conversation_summary ?? null,
      active_topic_id: memory.active_topic_id ?? null,
      previous_intent: memory.previous_intent ?? null,
      active_category: memory.active_category ?? null,
      active_merchant: memory.active_merchant ?? null,
      active_period: trustedPeriod.period,
      active_period_source: trustedPeriod.source,
      active_period_evidence_backed: trustedPeriod.evidence_backed,
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
    pending_workflow: workflow ? {
      kind: (workflow as any).kind ?? null,
      status: (workflow as any).status ?? null,
      slots: (workflow as any).slots ?? null,
    } : null,
  };
  return JSON.stringify(context).slice(0, 7200);
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

export function attachV3ReferenceToContract(
  turn: TurnSpecV3,
  contract: CanonicalConversationTurnContract,
): CanonicalConversationTurnContract {
  const reference = referenceFromV3(turn);
  // Explicit current-turn slots outrank inherited context: when this step
  // already names the category/merchant, a category/merchant reference (from
  // memory or another clause of a compound turn) must not narrow it.
  const explicitlyNamed = (target: string | null | undefined) =>
    (target === "category" && !!contract.focus.category)
    || (target === "merchant" && !!contract.focus.merchant);
  if (!reference || explicitlyNamed(reference.target)) {
    if (contract.reference && explicitlyNamed(contract.reference.target)) {
      return {
        ...contract,
        reference: null,
        resolution: { ...contract.resolution, reference: "not_applicable" },
      };
    }
    return contract;
  }
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

/** 400 from structured generation is technical unless the model itself emitted
 * an explicit clarification TurnSpec. Never blame the user for provider/schema
 * generation failure. */
export function isProviderStructuredFailure(reason: unknown): boolean {
  return /(?:structured_call_gateway_400|output_parse_failed|tool_use_failed|failed_generation|json_validate_failed|generated json does not match)/i
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

function humanTechnicalFallback(
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
    direct_reply: "Não consegui processar isso com segurança agora. Pode tentar de novo em instantes?",
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
    clarification_question: "Quero confirmar só um ponto antes de seguir. Qual período ou item você quer considerar?",
    resolution: {
      intent: "ambiguous", reference: "not_applicable", time: "ambiguous",
      entity: "not_applicable", action: "not_applicable",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  });
  return { contract, telemetry: fallbackTelemetry(telemetry, reason) };
}

export async function interpretConversationTurn(input: AuthorityInput): Promise<ConversationBrainOutcome> {
  const semantic = await interpretWithSingleSemanticAuthorityV3({
    text: input.text,
    history_text: historyText(input.history),
    context_text: typedContextText(input),
    deep_model: input.model ?? null,
    provider_override: input.provider_override ?? null,
  });

  if (semantic.turn) {
    const compoundEnabled = input.user_id
      ? await isEnabled("compound_turns_v1", input.user_id).catch(() => false)
      : false;
    if (compoundEnabled) {
      const plan = bridgeTurnSpecV3ToRuntimePlan(semantic.turn);
      if (plan.ok) {
        const [first, ...rest] = plan.contracts;
        return {
          contract: repairDailyGrainInContract(attachV3ReferenceToContract(semantic.turn, first), input.text),
          additional_contracts: rest.map((contract) => attachV3ReferenceToContract(semantic.turn!, contract)),
          telemetry: {
            ...semantic.telemetry,
            model: `v3-${semantic.tier}:${semantic.telemetry.model}`.slice(0, 180),
          },
        };
      }
      const reason = `v3_plan_rejected:${plan.errors.join("+")}`.slice(0, 220);
      console.warn("[ConversationAuthority] semantic plan cannot be represented", reason);
      return plan.errors.some((e) => e.startsWith("temporal_expression_unresolved:"))
        ? humanSemanticClarification(input, reason, semantic.telemetry)
        : humanTechnicalFallback(input, reason, semantic.telemetry);
    }

    const bridged = bridgeTurnSpecV3ToRuntime(semantic.turn);
    if (bridged.ok) {
      return {
        contract: repairDailyGrainInContract(attachV3ReferenceToContract(semantic.turn, bridged.contract), input.text),
        telemetry: {
          ...semantic.telemetry,
          model: `v3-${semantic.tier}:${semantic.telemetry.model}`.slice(0, 180),
        },
      };
    }

    const reason = `v3_bridge_rejected:${bridged.errors.join("+")}`.slice(0, 220);
    console.warn("[ConversationAuthority] semantic contract cannot be represented", reason);
    // Unresolved temporal expression is a genuine missing/ambiguous slot. Other
    // bridge failures are internal capability/contract failures and must not be
    // presented as if the user phrased the request badly.
    return bridged.errors.some((e) => e.startsWith("temporal_expression_unresolved:"))
      ? humanSemanticClarification(input, reason, semantic.telemetry)
      : humanTechnicalFallback(input, reason, semantic.telemetry);
  }

  const reason = String(
    semantic.telemetry.error
      ?? semantic.review_reasons.join("+")
      ?? semantic.violations.join("+")
      ?? "semantic_authority_unavailable",
  ).slice(0, 220);
  console.warn("[ConversationAuthority] semantic authority unavailable", reason);

  if (isProviderCapacityFailure(reason) || isProviderStructuredFailure(reason)) {
    return humanTechnicalFallback(input, reason, semantic.telemetry);
  }
  return humanTechnicalFallback(input, reason, semantic.telemetry);
}
