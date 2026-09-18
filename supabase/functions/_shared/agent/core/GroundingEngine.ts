// GroundingEngine (`nino_grounding_engine.v1`)
//
// Deterministic binding of conversational references to structured working
// memory. It never changes intent; it only proves what a reference points to.

import type { CanonicalConversationTurnContract } from "./ConversationTurnContract.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import {
  resolveStructuredReference,
  type GroundedReference,
} from "./ConversationReferenceStore.ts";

export type GroundedTurn = {
  turn: CanonicalConversationTurnContract;
  reference: GroundedReference;
  ok: boolean;
  clarification: string | null;
};

function clarificationFor(turn: CanonicalConversationTurnContract): string {
  const expression = turn.reference?.expression?.trim();
  if (expression) {
    return `Quando você diz “${expression}”, a referência anterior já não está clara para mim. Pode me dizer quais itens você quer comparar?`;
  }
  return "A referência anterior não está clara para mim. Pode me dizer quais itens você quer usar?";
}

export function groundTurnContract(
  turn: CanonicalConversationTurnContract,
  memory: ConversationMemory | null,
  now: Date = new Date(),
): GroundedTurn {
  const grounded = resolveStructuredReference(turn.reference, memory?.references ?? [], now);
  if (!turn.reference) {
    return { turn, reference: grounded, ok: true, clarification: null };
  }
  if (grounded.status !== "resolved") {
    return {
      turn,
      reference: grounded,
      ok: false,
      clarification: clarificationFor(turn),
    };
  }
  return { turn, reference: grounded, ok: true, clarification: null };
}

/**
 * Applies an already-grounded reference to engine arguments. This is binding,
 * not interpretation. Unsupported tool/scope combinations are left untouched
 * and will be rejected later by ContractFulfillmentGate if the scope was
 * required but not declared by execution.
 */
export function applyGroundedReferenceScope(
  tool: string,
  args: Record<string, unknown>,
  grounded: GroundedReference | null | undefined,
): Record<string, unknown> {
  if (!grounded || grounded.status !== "resolved" || !grounded.entity_labels.length) return args;
  if (grounded.target === "category" && ["compare_periods", "analyze_spending"].includes(tool)) {
    return { ...args, category_scope: [...grounded.entity_labels] };
  }
  return args;
}

/** Extracts the scope an engine declares it actually applied. */
export function executedReferenceScope(result: unknown): {
  target: string;
  entity_labels: string[];
} | null {
  const r = (result ?? {}) as Record<string, unknown>;
  const scope = r.applied_reference_scope as Record<string, unknown> | null | undefined;
  if (!scope || !Array.isArray(scope.entity_labels)) return null;
  const labels = scope.entity_labels.map((v) => String(v).trim()).filter(Boolean);
  if (!labels.length) return null;
  return { target: String(scope.target ?? "generic"), entity_labels: labels };
}
