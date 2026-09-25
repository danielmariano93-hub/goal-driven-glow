// Nino Runtime V3 — side-effect-free shadow evaluator.
//
// Phase 1 deliberately consumes the existing V2 canonical contract instead of
// making a second LLM call. This lets us measure structural incompatibilities
// (impossible read/domain combinations, task mapping gaps, invariant failures)
// before the authoritative V3 interpreter is introduced.

import type { ConversationTurnContract } from "../core/ConversationTurnContract.ts";
import { buildExecutionPlanV3 } from "./CapabilityRegistryV3.ts";
import { verifySemanticInvariantsV3 } from "./SemanticInvariantsV3.ts";
import { adaptConversationTurnContractToV3 } from "./TurnSpecV3Adapter.ts";

export type RuntimeV3ShadowResult = {
  version: "nino_runtime_v3_shadow.v1";
  status: "accepted" | "rejected";
  turn_kind: "conversation" | "clarification" | "task" | null;
  task_families: string[];
  execution_subsystems: string[];
  violations: string[];
};

export function evaluateRuntimeV3Shadow(
  contract: ConversationTurnContract,
  originalText: string,
): RuntimeV3ShadowResult {
  const adapted = adaptConversationTurnContractToV3(contract, originalText);
  if (!adapted.ok) {
    return {
      version: "nino_runtime_v3_shadow.v1",
      status: "rejected",
      turn_kind: null,
      task_families: [],
      execution_subsystems: [],
      violations: adapted.errors,
    };
  }

  // Legacy provenance is accepted only because this is a V2->V3 shadow bridge.
  // The authoritative V3 interpreter will not be allowed to emit legacy_source.
  const invariants = verifySemanticInvariantsV3(adapted.turn, { allowLegacySource: true });
  if (!invariants.ok) {
    return {
      version: "nino_runtime_v3_shadow.v1",
      status: "rejected",
      turn_kind: adapted.turn.kind,
      task_families: adapted.turn.kind === "task" ? adapted.turn.tasks.map((task) => task.family) : [],
      execution_subsystems: [],
      violations: invariants.violations,
    };
  }

  const plan = adapted.turn.kind === "task" ? buildExecutionPlanV3(adapted.turn) : null;
  return {
    version: "nino_runtime_v3_shadow.v1",
    status: "accepted",
    turn_kind: adapted.turn.kind,
    task_families: adapted.turn.kind === "task" ? adapted.turn.tasks.map((task) => task.family) : [],
    execution_subsystems: plan?.tasks.map((task) => task.capability.subsystem) ?? [],
    violations: [],
  };
}
