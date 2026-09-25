// Nino Runtime V3 — canonical semantic contract.
//
// Core invariant: a turn is interpreted once. After TurnSpecV3 exists, no later
// component is allowed to reinterpret user meaning; it may only validate,
// ground, compile, execute and compose from typed semantics.
//
// Unlike ConversationTurnContract v2, mode/domain/financial_read are not
// independent fields. Illegal combinations are unrepresentable by construction.

export const TURN_SPEC_V3 = "nino_turn_spec.v3" as const;

export const SLOT_SOURCES_V3 = [
  "current_turn",
  "quoted_turn",
  "workflow",
  "reference",
  "memory",
  "default",
  // Transitional only: used while V2 is adapted into V3 shadow evaluation.
  "legacy_contract",
] as const;
export type SlotSourceV3 = typeof SLOT_SOURCES_V3[number];

export type SourcedValueV3<T> = {
  value: T;
  source: SlotSourceV3;
  /** Literal span from the current/quoted message when one exists. */
  source_span: string | null;
};

export type SemanticActV3 =
  | "new_request"
  | "follow_up"
  | "repair"
  | "answer"
  | "topic_switch"
  | "conversational";

export type EntityFieldV3 = "category" | "merchant" | "card" | "account" | "payment_method";
export type FinancialMetricV3 =
  | "expense_amount"
  | "income_amount"
  | "balance"
  | "net_worth"
  | "debt_balance"
  | "future_installments"
  | "financial_health";
export type FinancialOperationV3 =
  | "value"
  | "sum"
  | "rank"
  | "breakdown"
  | "compare"
  | "trend"
  | "forecast"
  | "explain";
export type FinancialDimensionV3 = "category" | "merchant" | "card" | "account" | "month" | "weekday";

export type PeriodExpressionV3 = SourcedValueV3<string>;

export type EntityFilterV3 = {
  field: EntityFieldV3;
  entity: SourcedValueV3<string>;
};

export type ComparisonSpecV3 = {
  direction: "any" | "increase" | "decrease" | "both";
  baseline:
    | {
      kind: "period";
      period: PeriodExpressionV3 | null;
    }
    | {
      kind: "mean_previous_complete_months";
      months: number;
    };
  target: PeriodExpressionV3 | null;
};

export type FinancialQueryTaskV3 = {
  kind: "financial_query";
  family: "financial.query";
  metric: FinancialMetricV3;
  operation: FinancialOperationV3;
  group_by: FinancialDimensionV3[];
  filters: EntityFilterV3[];
  periods: PeriodExpressionV3[];
  limit: number | null;
  comparison: ComparisonSpecV3 | null;
};

export type GoalQueryTaskV3 = {
  kind: "goal_query";
  family: "goals";
  operation: "overview" | "progress" | "projection";
  goal: SourcedValueV3<string> | null;
};

export type AdvisoryTaskV3 = {
  kind: "advisory";
  family: "advisory";
  operation: "current_insight" | "next_best_action" | "goal_strategy" | "wealth_opportunity" | "financial_plan";
  periods: PeriodExpressionV3[];
};

export type FinancialWriteTaskV3 = {
  kind: "financial_write";
  family: "financial.write";
  /** Domain action name. Never a tool/function name. */
  action: string;
  slots: Record<string, unknown>;
};

export type SemanticTaskV3 = FinancialQueryTaskV3 | GoalQueryTaskV3 | AdvisoryTaskV3 | FinancialWriteTaskV3;

export type SemanticReferenceV3 =
  | {
    kind: "entity_reference";
    target: "category" | "merchant" | "card" | "account" | "goal";
    expression: string;
    source: "current_turn" | "quoted_turn" | "workflow" | "memory" | "legacy_contract";
  }
  | {
    kind: "result_set_reference";
    target: "category" | "merchant" | "goal" | "generic";
    expression: string;
    source: "current_turn" | "quoted_turn" | "workflow" | "memory" | "legacy_contract";
  };

export type TurnSpecCommonV3 = {
  version: typeof TURN_SPEC_V3;
  act: SemanticActV3;
  canonical_request: string;
  inherit_topic: boolean;
  references: SemanticReferenceV3[];
};

export type ConversationTurnSpecV3 = TurnSpecCommonV3 & {
  kind: "conversation";
  response_intent: "conversation";
  direct_reply: string;
};

export type ClarificationTurnSpecV3 = TurnSpecCommonV3 & {
  kind: "clarification";
  response_intent: "clarification";
  question: string;
};

export type TaskTurnSpecV3 = TurnSpecCommonV3 & {
  kind: "task";
  response_intent: "execute";
  tasks: [SemanticTaskV3, ...SemanticTaskV3[]];
};

export type TurnSpecV3 = ConversationTurnSpecV3 | ClarificationTurnSpecV3 | TaskTurnSpecV3;

export type TurnSpecValidationV3 = {
  ok: boolean;
  errors: string[];
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function validateTurnSpecV3(turn: TurnSpecV3): TurnSpecValidationV3 {
  const errors: string[] = [];
  if (turn.version !== TURN_SPEC_V3) errors.push("version_invalid");
  if (!String(turn.canonical_request ?? "").trim() && turn.kind !== "conversation") {
    errors.push("canonical_request_required");
  }

  if (turn.kind === "conversation" && !turn.direct_reply.trim()) errors.push("conversation_reply_required");
  if (turn.kind === "clarification" && !turn.question.trim()) errors.push("clarification_question_required");
  if (turn.kind === "task") {
    if (!turn.tasks.length) errors.push("task_turn_requires_tasks");
    if (turn.tasks.length > 8) errors.push("too_many_tasks");

    for (const [index, task] of turn.tasks.entries()) {
      if (task.kind === "financial_query") {
        if (task.group_by.length > 1) errors.push(`task_${index}_too_many_group_by`);
        const filterFields = task.filters.map((filter) => filter.field);
        if (unique(filterFields).length !== filterFields.length) errors.push(`task_${index}_duplicate_filter`);
        if (task.limit != null && (!Number.isInteger(task.limit) || task.limit < 1 || task.limit > 20)) {
          errors.push(`task_${index}_limit_invalid`);
        }
        if (task.operation === "compare" && !task.comparison) errors.push(`task_${index}_comparison_required`);
        if (task.operation !== "compare" && task.comparison) errors.push(`task_${index}_comparison_not_allowed`);
        if (task.comparison?.baseline.kind === "mean_previous_complete_months") {
          const months = task.comparison.baseline.months;
          if (!Number.isInteger(months) || months < 2 || months > 24) errors.push(`task_${index}_comparison_window_invalid`);
        }
      }
      if (task.kind === "goal_query" && task.operation === "overview" && task.goal) {
        errors.push(`task_${index}_goal_overview_must_not_target_single_goal`);
      }
      if (task.kind === "financial_write" && !task.action.trim()) errors.push(`task_${index}_write_action_required`);
    }
  }

  return { ok: errors.length === 0, errors: unique(errors) };
}
