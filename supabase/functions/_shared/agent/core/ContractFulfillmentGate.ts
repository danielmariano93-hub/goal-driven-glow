// ContractFulfillmentGate (`nino_contract_fulfillment.v1`)
//
// Generalizes the existing Preservation + Grounding gates without replacing
// them. It answers one question: did execution satisfy the canonical contracts
// that were requested?
//
// For financial reads:
// Turn Contract -> Financial Read Contract v4 -> Execution/Evidence
//                 \-> SemanticPreservation + GroundingGateV3
//
// This gate composes those existing guarantees and adds reference-scope
// preservation. No new semantic classifier lives here.

import type { GroundingResult } from "./GroundingGateV3.ts";
import type { PreservationResult } from "./SemanticPreservation.ts";
import {
  validateFinancialReadContract,
  type FinancialReadContractV4,
} from "./FinancialReadContract.ts";

export type ContractViolation = {
  code: string;
  detail: string;
};

export type ContractFulfillmentResult = {
  version: "nino_contract_fulfillment.v1";
  ok: boolean;
  violations: ContractViolation[];
};

function norm(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function sameSet(a: string[], b: string[]): boolean {
  const aa = [...new Set(a.map(norm))].sort();
  const bb = [...new Set(b.map(norm))].sort();
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}

export function verifyFinancialFulfillment(args: {
  contract: FinancialReadContractV4 | null;
  preservation: PreservationResult | null;
  grounding: GroundingResult | null;
  applied_reference_scope?: {
    target: string;
    entity_labels: string[];
  } | null;
}): ContractFulfillmentResult {
  const violations: ContractViolation[] = [];

  for (const error of validateFinancialReadContract(args.contract)) {
    violations.push({ code: "financial_contract_invalid", detail: error });
  }

  if (args.preservation && !args.preservation.compatible) {
    for (const mismatch of args.preservation.mismatches) {
      violations.push({
        code: "requested_vs_executed_mismatch",
        detail: String((mismatch as any)?.reason ?? "preservation_mismatch"),
      });
    }
  }

  if (args.grounding && !args.grounding.ok) {
    for (const violation of args.grounding.violations) {
      violations.push({
        code: "evidence_grounding_violation",
        detail: String((violation as any)?.reason ?? (violation as any)?.type ?? "grounding_violation"),
      });
    }
  }

  const requestedScope = args.contract?.grounded_reference;
  if (requestedScope?.entity_labels?.length) {
    const executedScope = args.applied_reference_scope;
    if (!executedScope) {
      violations.push({
        code: "reference_scope_not_executed",
        detail: "grounded reference existed but execution did not declare the applied scope",
      });
    } else if (requestedScope.target !== executedScope.target
      || !sameSet(requestedScope.entity_labels, executedScope.entity_labels)) {
      violations.push({
        code: "reference_scope_changed",
        detail: "executed reference scope differs from the grounded reference set",
      });
    }
  }

  return {
    version: "nino_contract_fulfillment.v1",
    ok: violations.length === 0,
    violations,
  };
}
