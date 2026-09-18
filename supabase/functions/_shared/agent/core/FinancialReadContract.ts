// FinancialReadContract (`financial_read_contract.v4`)
//
// Domain-specific contract subordinated to ConversationTurnContract v2.
// There is ONE conversational authority; this contract only canonicalizes the
// already-understood financial READ into the existing FinancialQueryIR v3.
//
// This file deliberately does not classify language, choose tools or resolve
// entities. It binds Turn Contract -> canonical financial IR + grounded scope.

import type {
  CanonicalConversationTurnContract,
  ResolutionState,
} from "./ConversationTurnContract.ts";
import type { FinancialQueryIRv3 } from "./FinancialIRv3.ts";
import type { GroundedReference } from "./ConversationReferenceStore.ts";

export type FinancialReadContractV4 = {
  version: "financial_read_contract.v4";
  source_turn_version: "conversation_turn_contract.v2";
  domain: "financial_read";
  requested: FinancialQueryIRv3;
  slots: {
    intent: ResolutionState;
    reference: ResolutionState;
    time: ResolutionState;
    entity: ResolutionState;
  };
  grounded_reference: {
    reference_id: string | null;
    target: GroundedReference["target"];
    entity_labels: string[];
  } | null;
};

export function buildFinancialReadContract(args: {
  turn: CanonicalConversationTurnContract;
  requested: FinancialQueryIRv3;
  grounded_reference?: GroundedReference | null;
}): FinancialReadContractV4 | null {
  if (args.turn.mode !== "read") return null;
  if (args.turn.domain !== "financial_read") return null;

  const grounded = args.grounded_reference ?? null;
  const refStatus: ResolutionState = args.turn.reference
    ? (grounded?.status === "resolved" ? "resolved" : grounded?.status === "ambiguous" ? "ambiguous" : "missing")
    : "not_applicable";

  return {
    version: "financial_read_contract.v4",
    source_turn_version: "conversation_turn_contract.v2",
    domain: "financial_read",
    requested: args.requested,
    slots: {
      intent: args.turn.resolution.intent,
      reference: refStatus,
      time: args.turn.resolution.time,
      entity: args.turn.resolution.entity,
    },
    grounded_reference: args.turn.reference
      && grounded?.status === "resolved"
      && grounded.entity_labels.length > 0
      ? {
        reference_id: grounded.reference_id,
        target: grounded.target,
        entity_labels: grounded.entity_labels,
      }
      : null,
  };
}

export function validateFinancialReadContract(contract: FinancialReadContractV4 | null): string[] {
  if (!contract) return ["financial_read_contract_missing"];
  const errors: string[] = [];
  if (contract.version !== "financial_read_contract.v4") errors.push("financial_read_contract_version");
  if (contract.source_turn_version !== "conversation_turn_contract.v2") errors.push("source_turn_version_invalid");
  if (contract.domain !== "financial_read") errors.push("financial_read_domain_invalid");

  for (const [slot, state] of Object.entries(contract.slots)) {
    if (state === "ambiguous" || state === "missing" || state === "conflicting") {
      errors.push(`slot_unresolved:${slot}:${state}`);
    }
  }

  if (contract.grounded_reference?.entity_labels.length === 0) errors.push("grounded_reference_empty");
  return errors;
}
