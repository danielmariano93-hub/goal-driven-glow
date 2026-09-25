// Nino Runtime V3 — semantic comparator for V2 x V3 shadow observations.
//
// Comparison deliberately ignores prose style and provenance labels. We compare
// the semantic contract: turn kind/act, task families, entities and periods.

import type { TurnSpecV3, SemanticTaskV3 } from "./TurnSpecV3.ts";

export type SemanticSignatureV3 = {
  kind: TurnSpecV3["kind"];
  act: TurnSpecV3["act"];
  canonical_request: string;
  task_families: string[];
  entities: Array<{ field: string; value: string }>;
  periods: string[];
  tasks: Array<Record<string, unknown>>;
};

export type SemanticComparisonV3 = {
  same_kind: boolean;
  same_act: boolean;
  same_task_families: boolean;
  same_entities: boolean;
  same_periods: boolean;
  semantic_match: boolean;
  divergence_reasons: string[];
};

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map(norm).filter(Boolean))].sort();
}

function entityPairs(tasks: SemanticTaskV3[]): Array<{ field: string; value: string }> {
  const out: Array<{ field: string; value: string }> = [];
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      for (const filter of task.filters) {
        out.push({ field: filter.field, value: norm(filter.entity.value) });
      }
    } else if (task.kind === "goal_query" && task.goal?.value) {
      out.push({ field: "goal", value: norm(task.goal.value) });
    }
  }
  return out
    .filter((item) => item.value)
    .sort((a, b) => `${a.field}:${a.value}`.localeCompare(`${b.field}:${b.value}`));
}

function periodValues(tasks: SemanticTaskV3[]): string[] {
  const out: string[] = [];
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      out.push(...task.periods.map((period) => period.value));
      if (task.comparison?.baseline.kind === "period" && task.comparison.baseline.period?.value) {
        out.push(task.comparison.baseline.period.value);
      }
      if (task.comparison?.target?.value) out.push(task.comparison.target.value);
    } else if (task.kind === "advisory") {
      out.push(...task.periods.map((period) => period.value));
    }
  }
  return sortedUnique(out);
}

function taskShape(task: SemanticTaskV3): Record<string, unknown> {
  if (task.kind === "financial_query") {
    return {
      kind: task.kind,
      family: task.family,
      metric: task.metric,
      operation: task.operation,
      group_by: [...task.group_by].sort(),
      filters: entityPairs([task]),
      periods: periodValues([task]),
      limit: task.limit,
      comparison: task.comparison
        ? {
          direction: task.comparison.direction,
          baseline_kind: task.comparison.baseline.kind,
          baseline_months: task.comparison.baseline.kind === "mean_previous_complete_months"
            ? task.comparison.baseline.months
            : null,
        }
        : null,
    };
  }
  if (task.kind === "goal_query") {
    return { kind: task.kind, family: task.family, operation: task.operation, goal: norm(task.goal?.value) || null };
  }
  if (task.kind === "advisory") {
    return { kind: task.kind, family: task.family, operation: task.operation, periods: periodValues([task]) };
  }
  return {
    kind: task.kind,
    family: task.family,
    action: task.action,
    slot_keys: Object.keys(task.slots ?? {}).sort(),
  };
}

export function semanticSignatureV3(turn: TurnSpecV3): SemanticSignatureV3 {
  const tasks = turn.kind === "task" ? [...turn.tasks] : [];
  return {
    kind: turn.kind,
    act: turn.act,
    canonical_request: norm(turn.canonical_request),
    task_families: tasks.map((task) => task.family).sort(),
    entities: entityPairs(tasks),
    periods: periodValues(tasks),
    tasks: tasks.map(taskShape),
  };
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

export function compareSemanticSignaturesV3(
  official: SemanticSignatureV3,
  candidate: SemanticSignatureV3,
): SemanticComparisonV3 {
  const sameKind = official.kind === candidate.kind;
  const sameAct = official.act === candidate.act;
  const sameFamilies = stable(official.task_families) === stable(candidate.task_families);
  const sameEntities = stable(official.entities) === stable(candidate.entities);
  const samePeriods = stable(official.periods) === stable(candidate.periods);
  const sameTasks = stable(official.tasks) === stable(candidate.tasks);
  const reasons: string[] = [];
  if (!sameKind) reasons.push("turn_kind_mismatch");
  if (!sameAct) reasons.push("act_mismatch");
  if (!sameFamilies) reasons.push("task_family_mismatch");
  if (!sameEntities) reasons.push("entity_mismatch");
  if (!samePeriods) reasons.push("period_mismatch");
  if (!sameTasks) reasons.push("task_semantics_mismatch");
  return {
    same_kind: sameKind,
    same_act: sameAct,
    same_task_families: sameFamilies,
    same_entities: sameEntities,
    same_periods: samePeriods,
    semantic_match: sameKind && sameAct && sameFamilies && sameEntities && samePeriods && sameTasks,
    divergence_reasons: reasons,
  };
}
