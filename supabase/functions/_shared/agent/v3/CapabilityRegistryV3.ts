// Nino Runtime V3 — capability registry.
//
// The semantic interpreter selects stable capability FAMILIES, never physical
// tools. This registry binds a semantic task to an execution subsystem. Tool
// selection remains deterministic inside that subsystem and may evolve without
// changing the semantic contract.

import type { SemanticTaskV3, TaskTurnSpecV3 } from "./TurnSpecV3.ts";

export type ExecutionSubsystemV3 =
  | "financial_ir"
  | "goal_engine"
  | "advisory_engine"
  | "write_workflow";

export type CapabilityFamilyV3 = SemanticTaskV3["family"];

export type CapabilityDescriptorV3 = {
  family: CapabilityFamilyV3;
  subsystem: ExecutionSubsystemV3;
  reads_personal_financial_data: boolean;
  can_write: boolean;
  evidence_required: boolean;
  description: string;
};

export const CAPABILITY_REGISTRY_V3: Record<CapabilityFamilyV3, CapabilityDescriptorV3> = {
  "financial.query": {
    family: "financial.query",
    subsystem: "financial_ir",
    reads_personal_financial_data: true,
    can_write: false,
    evidence_required: true,
    description: "Canonical financial query compiled into the existing typed Financial IR runtime.",
  },
  goals: {
    family: "goals",
    subsystem: "goal_engine",
    reads_personal_financial_data: true,
    can_write: false,
    evidence_required: true,
    description: "Goal overview/progress/projection backed by the canonical goals engine.",
  },
  advisory: {
    family: "advisory",
    subsystem: "advisory_engine",
    reads_personal_financial_data: true,
    can_write: false,
    evidence_required: true,
    description: "Evidence-backed insight or recommendation; never free-form personal financial truth.",
  },
  "financial.write": {
    family: "financial.write",
    subsystem: "write_workflow",
    reads_personal_financial_data: true,
    can_write: true,
    evidence_required: false,
    description: "Draft/confirm/execute workflow for financial mutations.",
  },
};

export type PlannedTaskV3 = {
  index: number;
  task: SemanticTaskV3;
  capability: CapabilityDescriptorV3;
};

export type ExecutionPlanV3 = {
  version: "nino_execution_plan.v3";
  tasks: PlannedTaskV3[];
  has_writes: boolean;
  evidence_required: boolean;
};

export function buildExecutionPlanV3(turn: TaskTurnSpecV3): ExecutionPlanV3 {
  const tasks = turn.tasks.map((task, index) => ({
    index,
    task,
    capability: CAPABILITY_REGISTRY_V3[task.family],
  }));
  return {
    version: "nino_execution_plan.v3",
    tasks,
    has_writes: tasks.some((item) => item.capability.can_write),
    evidence_required: tasks.some((item) => item.capability.evidence_required),
  };
}
