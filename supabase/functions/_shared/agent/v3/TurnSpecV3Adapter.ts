// Transitional adapter used only for V3 shadow evaluation.
//
// It converts the current canonical ConversationTurnContract into TurnSpecV3
// without granting V2 any authority inside the future V3 runtime. Invalid V2
// combinations are surfaced as explicit errors instead of being repaired by a
// second semantic classifier.

import type { ConversationTurnContract } from "../core/ConversationTurnContract.ts";
import { normalizePeriodExpressions } from "../core/ConversationTurnContract.ts";
import type {
  ComparisonSpecV3,
  EntityFilterV3,
  FinancialQueryTaskV3,
  GoalQueryTaskV3,
  PeriodExpressionV3,
  SemanticReferenceV3,
  SemanticTaskV3,
  TurnSpecV3,
} from "./TurnSpecV3.ts";
import { TURN_SPEC_V3, validateTurnSpecV3 } from "./TurnSpecV3.ts";

export type TurnSpecV3AdaptResult =
  | { ok: true; turn: TurnSpecV3; errors: [] }
  | { ok: false; turn: null; errors: string[] };

function period(expression: string): PeriodExpressionV3 {
  return { value: expression, source: "legacy_contract", source_span: null };
}

function filtersOf(contract: ConversationTurnContract, raw: Array<{ field: string; value: string }>): EntityFilterV3[] {
  return raw.map((filter) => ({
    field: filter.field as EntityFilterV3["field"],
    entity: {
      value: String(filter.value),
      source: "legacy_contract",
      source_span: null,
    },
  }));
}

function comparisonOf(query: NonNullable<ConversationTurnContract["financial_read"]>["queries"][number]): ComparisonSpecV3 | null {
  if (query.operation !== "compare") return null;
  const target = query.comparison_target_expression ? period(query.comparison_target_expression) : null;
  if (query.comparison_baseline === "mean_previous_complete_months") {
    return {
      direction: query.comparison_direction ?? "any",
      baseline: {
        kind: "mean_previous_complete_months",
        months: Number(query.comparison_baseline_window ?? 0),
      },
      target,
    };
  }
  return {
    direction: query.comparison_direction ?? "any",
    baseline: {
      kind: "period",
      period: query.comparison_baseline_expression ? period(query.comparison_baseline_expression) : null,
    },
    target,
  };
}

function referenceOf(contract: ConversationTurnContract): SemanticReferenceV3[] {
  const reference = contract.reference;
  if (!reference || !reference.expression) return [];
  const source = "legacy_contract" as const;
  if (reference.kind === "previous_result_set") {
    const target = ["category", "merchant", "goal"].includes(reference.target)
      ? reference.target as "category" | "merchant" | "goal"
      : "generic";
    return [{ kind: "result_set_reference", target, expression: reference.expression, source }];
  }
  if (["category", "merchant", "card", "account", "goal"].includes(reference.target)) {
    return [{
      kind: "entity_reference",
      target: reference.target as "category" | "merchant" | "card" | "account" | "goal",
      expression: reference.expression,
      source,
    }];
  }
  return [];
}

function financialTasks(contract: ConversationTurnContract): { tasks: SemanticTaskV3[]; errors: string[] } {
  const errors: string[] = [];
  const tasks: SemanticTaskV3[] = [];
  const request = contract.financial_read;
  if (!request?.queries?.length) return { tasks, errors: ["financial_read_without_queries"] };
  const expressions = normalizePeriodExpressions(contract.focus).map(period);

  for (const query of request.queries) {
    if (query.metric === "goal_progress") {
      if (!["value", "sum", "forecast"].includes(query.operation)) {
        errors.push(`goal_operation_unsupported:${query.operation}`);
        continue;
      }
      const goal: GoalQueryTaskV3["goal"] = contract.focus.goal
        ? { value: contract.focus.goal, source: "legacy_contract", source_span: null }
        : null;
      tasks.push({
        kind: "goal_query",
        family: "goals",
        operation: query.operation === "forecast" ? "projection" : goal ? "progress" : "overview",
        goal,
      });
      continue;
    }

    const task: FinancialQueryTaskV3 = {
      kind: "financial_query",
      family: "financial.query",
      metric: query.metric as FinancialQueryTaskV3["metric"],
      operation: query.operation,
      group_by: [...query.group_by],
      filters: filtersOf(contract, query.filters),
      periods: expressions,
      limit: query.limit,
      comparison: comparisonOf(query),
    };
    tasks.push(task);
  }
  return { tasks, errors };
}

export function adaptConversationTurnContractToV3(
  contract: ConversationTurnContract,
  originalText = "",
): TurnSpecV3AdaptResult {
  const common = {
    version: TURN_SPEC_V3,
    act: contract.act,
    canonical_request: String(contract.canonical_request ?? originalText ?? "").trim(),
    inherit_topic: contract.inherit_focus,
    references: referenceOf(contract),
  } as const;

  let turn: TurnSpecV3 | null = null;
  const errors: string[] = [];

  if (contract.mode === "converse") {
    turn = {
      ...common,
      kind: "conversation",
      response_intent: "conversation",
      direct_reply: String(contract.direct_reply ?? "").trim(),
    };
  } else if (contract.mode === "clarify") {
    turn = {
      ...common,
      kind: "clarification",
      response_intent: "clarification",
      question: String(contract.clarification_question ?? "").trim(),
    };
  } else if (contract.mode === "write") {
    if (contract.domain !== "financial_write" || !contract.action) {
      errors.push("write_without_financial_write_action");
    } else {
      turn = {
        ...common,
        kind: "task",
        response_intent: "execute",
        tasks: [{
          kind: "financial_write",
          family: "financial.write",
          action: contract.action.action,
          slots: { ...contract.action.slots },
        }],
      };
    }
  } else if (contract.mode === "read") {
    if (contract.domain === "financial_read") {
      const compiled = financialTasks(contract);
      errors.push(...compiled.errors);
      if (compiled.tasks.length) {
        turn = {
          ...common,
          kind: "task",
          response_intent: "execute",
          tasks: compiled.tasks as [SemanticTaskV3, ...SemanticTaskV3[]],
        };
      }
    } else if (contract.domain === "advisory" && contract.advisory_kind) {
      turn = {
        ...common,
        kind: "task",
        response_intent: "execute",
        tasks: [{
          kind: "advisory",
          family: "advisory",
          operation: contract.advisory_kind,
          periods: normalizePeriodExpressions(contract.focus).map(period),
        }],
      };
    } else {
      // This is the class of impossible contract that produced production
      // compiler_failed for factual goal queries. V3 refuses it explicitly.
      errors.push(`read_without_executable_domain:${contract.domain}`);
    }
  }

  if (!turn) return { ok: false, turn: null, errors: [...new Set(errors.length ? errors : ["v3_adapter_no_turn"])] };
  const structural = validateTurnSpecV3(turn);
  errors.push(...structural.errors);
  return errors.length
    ? { ok: false, turn: null, errors: [...new Set(errors)] }
    : { ok: true, turn, errors: [] };
}
