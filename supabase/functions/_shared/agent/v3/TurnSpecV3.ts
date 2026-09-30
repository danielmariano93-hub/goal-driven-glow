// Nino Runtime V3 — canonical semantic contract.
//
// Core invariant: a turn is interpreted once. After TurnSpecV3 exists, no later
// component is allowed to reinterpret user meaning; it may only validate,
// ground, compile, execute and compose from typed semantics.

export const TURN_SPEC_V3 = "nino_turn_spec.v3" as const;

export const SLOT_SOURCES_V3 = [
  "current_turn",
  "quoted_turn",
  "workflow",
  "reference",
  "memory",
  "default",
  "legacy_contract",
] as const;
export type SlotSourceV3 = typeof SLOT_SOURCES_V3[number];

export type SourcedValueV3<T> = {
  value: T;
  source: SlotSourceV3;
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
export type FinancialDimensionV3 = "category" | "merchant" | "card" | "account" | "month" | "weekday" | "day" | "week" | "quarter";

export type PeriodExpressionV3 = SourcedValueV3<string>;

export type EntityFilterV3 = {
  field: EntityFieldV3;
  entity: SourcedValueV3<string>;
};

export type ComparisonSpecV3 = {
  direction: "any" | "increase" | "decrease" | "both";
  baseline:
    | { kind: "period"; period: PeriodExpressionV3 | null }
    | { kind: "mean_previous_complete_months"; months: number };
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

export const ADVISORY_OPERATIONS_V3 = [
  "current_insight",
  "next_best_action",
  "goal_strategy",
  "wealth_opportunity",
  "financial_plan",
  "scenario",
  "decision",
  "period_review",
] as const;
export type AdvisoryOperationV3 = typeof ADVISORY_OPERATIONS_V3[number];

export const SCENARIO_LEVERS_V3 = [
  "cut_category",
  "extra_savings",
  "purchase",
  "income_change",
] as const;
export type ScenarioLeverV3 = typeof SCENARIO_LEVERS_V3[number];

/**
 * Hypothetical parameters are user-stated assumptions, never personal facts.
 * Values stay textual here; the deterministic scenario engine parses and
 * validates them before any calculation.
 */
export type ScenarioSpecV3 = {
  lever: ScenarioLeverV3;
  category: string | null;
  amount: string | null;
  percent: number | null;
  goal: string | null;
};

export type AdvisoryTaskV3 = {
  kind: "advisory";
  family: "advisory";
  operation: AdvisoryOperationV3;
  periods: PeriodExpressionV3[];
  /** Required for operation=scenario; optional context for decision. */
  scenario?: ScenarioSpecV3 | null;
  /** Options the user is weighing, verbatim, for operation=decision. */
  options?: string[];
};

export type FinancialWriteTaskV3 = {
  kind: "financial_write";
  family: "financial.write";
  action: string;
  slots: Record<string, unknown>;
};

export type SemanticTaskV3 = FinancialQueryTaskV3 | GoalQueryTaskV3 | AdvisoryTaskV3 | FinancialWriteTaskV3;

export type SemanticReferenceV3 =
  | {
    kind: "entity_reference";
    target: "category" | "merchant" | "card" | "account" | "goal" | "debt";
    expression: string;
    source: "current_turn" | "quoted_turn" | "workflow" | "memory" | "legacy_contract";
  }
  | {
    kind: "result_set_reference";
    target: "category" | "merchant" | "goal" | "debt" | "generic";
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

export type TurnSpecValidationV3 = { ok: boolean; errors: string[] };

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

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
      if (task.kind === "advisory") {
        if (!(ADVISORY_OPERATIONS_V3 as readonly string[]).includes(task.operation)) {
          errors.push(`task_${index}_advisory_operation_invalid`);
        }
        if (task.operation === "scenario") {
          const scenario = task.scenario ?? null;
          if (!scenario || !(SCENARIO_LEVERS_V3 as readonly string[]).includes(scenario.lever)) {
            errors.push(`task_${index}_scenario_required`);
          } else {
            const hasMagnitude = Boolean(String(scenario.amount ?? "").trim())
              || (scenario.percent != null && Number.isFinite(scenario.percent));
            if (!hasMagnitude) errors.push(`task_${index}_scenario_magnitude_required`);
            if (scenario.lever === "cut_category" && !String(scenario.category ?? "").trim()) {
              errors.push(`task_${index}_scenario_category_required`);
            }
            if (scenario.percent != null && (scenario.percent <= 0 || scenario.percent > 100)) {
              errors.push(`task_${index}_scenario_percent_invalid`);
            }
          }
        } else if (task.scenario) {
          errors.push(`task_${index}_scenario_not_allowed`);
        }
        if (task.operation === "decision" && (task.options ?? []).length > 6) {
          errors.push(`task_${index}_too_many_decision_options`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors: unique(errors) };
}
