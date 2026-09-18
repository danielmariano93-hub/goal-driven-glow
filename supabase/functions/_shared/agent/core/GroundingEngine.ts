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
