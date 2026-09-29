// Nino Runtime V3 — deterministic bridge into the existing execution runtime.
//
// Transitional compatibility only. TurnSpecV3 remains the single semantic
// authority. Time is grounded HERE, once, before entering the mature V2
// execution engines. `period_expression` preserves the user's source wording
// for provenance/UI only; `period_expressions` carries canonical date windows
// used by execution and fulfillment.

import { isActionKind } from "../core/ActionIR.ts";
import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
  type FinancialReadSemanticQuery,
  type TurnReference,
} from "../core/ConversationTurnContract.ts";
import type {
  FinancialQueryTaskV3,
  FinancialWriteTaskV3,
  GoalQueryTaskV3,
  PeriodExpressionV3,
  SemanticTaskV3,
  TurnSpecV3,
} from "./TurnSpecV3.ts";
import { verifySemanticInvariantsV3 } from "./SemanticInvariantsV3.ts";
import {
  buildTemporalContractV3,
  canonicalizePeriodExpressionV3,
} from "./TemporalContractV3.ts";

export type V3RuntimeBridgeResult =
  | { ok: true; contract: CanonicalConversationTurnContract; errors: [] }
  | { ok: false; contract: null; errors: string[] };

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function canonicalPeriod(period: PeriodExpressionV3 | null | undefined, now: Date): string | null {
  const canonical = canonicalizePeriodExpressionV3(period, now);
  return canonical?.value ?? null;
}

/** Canonical windows only. These are authoritative for execution. */
function periodExpressions(tasks: SemanticTaskV3[], now: Date): string[] {
  const values: string[] = [];
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      for (const period of task.periods) {
        const canonical = canonicalPeriod(period, now);
        if (canonical) values.push(canonical);
      }
      if (task.comparison?.baseline.kind === "period") {
        const canonical = canonicalPeriod(task.comparison.baseline.period, now);
        if (canonical) values.push(canonical);
      }
      const target = canonicalPeriod(task.comparison?.target, now);
      if (target) values.push(target);
    }
    if (task.kind === "advisory") {
      for (const period of task.periods) {
        const canonical = canonicalPeriod(period, now);
        if (canonical) values.push(canonical);
      }
    }
  }
  return unique(values.map((value) => value.trim()).filter(Boolean));
}

/** Original semantic expressions only for provenance/presentation. */
function sourcePeriodExpressions(tasks: SemanticTaskV3[]): string[] {
  const values: string[] = [];
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      values.push(...task.periods.map((period) => period.value));
      if (task.comparison?.baseline.kind === "period" && task.comparison.baseline.period) {
        values.push(task.comparison.baseline.period.value);
      }
      if (task.comparison?.target) values.push(task.comparison.target.value);
    }
    if (task.kind === "advisory") values.push(...task.periods.map((period) => period.value));
  }
  return unique(values.map((value) => String(value ?? "").trim()).filter(Boolean));
}

function runtimeReference(turn: TurnSpecV3): TurnReference | null {
  if (!turn.references.length) return null;
  if (turn.references.length !== 1) return null;
  const ref = turn.references[0];
  return {
    kind: ref.kind === "entity_reference" ? "previous_entity" : "previous_result_set",
    target: ref.target,
    expression: ref.expression,
    status: "resolved",
  };
}

function financialQuery(task: FinancialQueryTaskV3, now: Date): FinancialReadSemanticQuery | null {
  const comparison = task.comparison;
  const baselineExpression = comparison?.baseline.kind === "period"
    ? canonicalPeriod(comparison.baseline.period, now)
    : null;
  const targetExpression = canonicalPeriod(comparison?.target, now);
  return {
    metric: task.metric,
    operation: task.operation,
    group_by: [...task.group_by],
    filters: task.filters.map((filter) => ({
      field: filter.field as "category" | "merchant" | "card" | "account" | "payment_method",
      op: "eq" as const,
      value: filter.entity.value,
    })),
    limit: task.limit,
    comparison_direction: comparison?.direction ?? "any",
    comparison_baseline: comparison?.baseline.kind ?? "period",
    comparison_baseline_window: comparison?.baseline.kind === "mean_previous_complete_months"
      ? comparison.baseline.months
      : null,
    comparison_baseline_expression: baselineExpression,
    comparison_target_expression: targetExpression,
  };
}

function goalQuery(task: GoalQueryTaskV3): FinancialReadSemanticQuery | null {
  if (task.operation === "projection") return null;
  return {
    metric: "goal_progress",
    operation: "value",
    group_by: [],
    filters: [],
    limit: null,
    comparison_direction: "any",
    comparison_baseline: "period",
    comparison_baseline_window: null,
    comparison_baseline_expression: null,
    comparison_target_expression: null,
  };
}

function explicitFocus(tasks: SemanticTaskV3[]) {
  let category: string | null = null;
  let merchant: string | null = null;
  let goal: string | null = null;
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      category ??= task.filters.find((filter) => filter.field === "category")?.entity.value ?? null;
      merchant ??= task.filters.find((filter) => filter.field === "merchant")?.entity.value ?? null;
    }
    if (task.kind === "goal_query") goal ??= task.goal?.value ?? null;
  }
  return { category, merchant, goal };
}

function compileAtomicGoalCreate(tasks: SemanticTaskV3[]): FinancialWriteTaskV3 | null {
  if (tasks.length !== 2 || tasks.some((task) => task.kind !== "financial_write")) return null;
  const writes = tasks as FinancialWriteTaskV3[];
  const create = writes.find((task) => task.action === "goal.create");
  const contribute = writes.find((task) => task.action === "goal.contribute");
  if (!create || !contribute) return null;

  const goalName = String(create.slots.name ?? "").trim();
  const targetAmount = String(create.slots.target_amount ?? create.slots.amount ?? "").trim();
  const contributionAmount = String(contribute.slots.amount ?? "").trim();
  if (!goalName || !targetAmount || !contributionAmount) return null;

  const referencedGoal = String(contribute.slots.goal ?? "").trim();
  if (referencedGoal && normalized(referencedGoal) !== normalized(goalName)) return null;

  const allowedContributionSlots = new Set(["goal", "amount", "date", "occurred_at"]);
  if (Object.keys(contribute.slots).some((key) => !allowedContributionSlots.has(key))) return null;

  return {
    kind: "financial_write",
    family: "financial.write",
    action: "goal.create",
    slots: {
      ...create.slots,
      initial_contribution: contributionAmount,
      ...(contribute.slots.date || contribute.slots.occurred_at
        ? { contribution_date: contribute.slots.date ?? contribute.slots.occurred_at }
        : {}),
    },
  };
}

export function bridgeTurnSpecV3ToRuntime(turn: TurnSpecV3, now: Date = new Date()): V3RuntimeBridgeResult {
  const invariant = verifySemanticInvariantsV3(turn);
  if (!invariant.ok) return { ok: false, contract: null, errors: invariant.violations };
  if (turn.references.length > 1) {
    return { ok: false, contract: null, errors: ["multiple_references_not_executable"] };
  }

  // First-class temporal grounding. If V3 said there is a period but code cannot
  // prove its dates, fail closed HERE. Never let V2/raw-text defaults substitute
  // another period.
  const temporal = buildTemporalContractV3(turn, now);
  if (!temporal.ok) return { ok: false, contract: null, errors: temporal.errors };

  const reference = runtimeReference(turn);

  if (turn.kind === "conversation") {
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "converse",
      domain: "conversation",
      canonical_request: turn.canonical_request || null,
      inherit_focus: turn.inherit_topic,
      focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
      action: null,
      direct_reply: turn.direct_reply,
      clarification_question: null,
      resolution: { intent: "resolved", reference: reference ? "resolved" : "not_applicable", time: "not_applicable", entity: "not_applicable", action: "not_applicable" },
      reference,
      financial_read: null,
      advisory_kind: null,
    });
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["conversation_bridge_rejected"] };
  }

  if (turn.kind === "clarification") {
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "clarify",
      domain: "conversation",
      canonical_request: turn.canonical_request || null,
      inherit_focus: turn.inherit_topic,
      focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
      action: null,
      direct_reply: null,
      clarification_question: turn.question,
      resolution: { intent: "ambiguous", reference: reference ? "resolved" : "not_applicable", time: "not_applicable", entity: "not_applicable", action: "not_applicable" },
      reference,
      financial_read: null,
      advisory_kind: null,
    });
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["clarification_bridge_rejected"] };
  }

  const families = unique(turn.tasks.map((task) => task.family));
  const periods = periodExpressions(turn.tasks, now);
  const sourcePeriods = sourcePeriodExpressions(turn.tasks);
  const focus = explicitFocus(turn.tasks);
  const temporalFocus = {
    ...focus,
    // source wording is provenance only; canonical list below is authoritative.
    period_expression: sourcePeriods[0] ?? null,
    period_expressions: periods,
  };

  if (families.length === 1 && families[0] === "financial.write") {
    const compiledGoal = compileAtomicGoalCreate(turn.tasks);
    const task = compiledGoal ?? (
      turn.tasks.length === 1 && turn.tasks[0].kind === "financial_write"
        ? turn.tasks[0]
        : null
    );
    if (!task || !isActionKind(task.action)) {
      return { ok: false, contract: null, errors: ["write_shape_not_executable"] };
    }
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "write",
      domain: "financial_write",
      canonical_request: turn.canonical_request,
      inherit_focus: turn.inherit_topic,
      focus: temporalFocus,
      action: { action: task.action, slots: task.slots },
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: reference ? "resolved" : "not_applicable", time: periods.length ? "resolved" : "not_applicable", entity: focus.category || focus.merchant || focus.goal ? "resolved" : "not_applicable", action: "resolved" },
      reference,
      financial_read: null,
      advisory_kind: null,
    });
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["write_bridge_rejected"] };
  }

  if (families.length === 1 && families[0] === "advisory") {
    if (turn.tasks.length !== 1 || turn.tasks[0].kind !== "advisory") {
      return { ok: false, contract: null, errors: ["advisory_shape_not_executable"] };
    }
    const task = turn.tasks[0];
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "read",
      domain: "advisory",
      canonical_request: turn.canonical_request,
      inherit_focus: turn.inherit_topic,
      focus: temporalFocus,
      action: null,
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: reference ? "resolved" : "not_applicable", time: periods.length ? "resolved" : "not_applicable", entity: "not_applicable", action: "not_applicable" },
      reference,
      financial_read: null,
      advisory_kind: task.operation,
    });
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["advisory_bridge_rejected"] };
  }

  if (families.every((family) => family === "financial.query" || family === "goals")) {
    if (turn.tasks.length > 4) return { ok: false, contract: null, errors: ["too_many_runtime_queries"] };
    const queries: FinancialReadSemanticQuery[] = [];
    for (const task of turn.tasks) {
      const query = task.kind === "financial_query"
        ? financialQuery(task, now)
        : task.kind === "goal_query"
          ? goalQuery(task)
          : null;
      if (!query) return { ok: false, contract: null, errors: [`task_not_executable:${task.kind}`] };
      queries.push(query);
    }
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "read",
      domain: "financial_read",
      canonical_request: turn.canonical_request,
      inherit_focus: turn.inherit_topic,
      focus: temporalFocus,
      action: null,
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: reference ? "resolved" : "not_applicable", time: periods.length ? "resolved" : "not_applicable", entity: focus.category || focus.merchant || focus.goal ? "resolved" : "not_applicable", action: "not_applicable" },
      reference,
      financial_read: { intent: queries.some((query) => ["compare", "trend", "explain"].includes(query.operation)) ? "analyze" : "lookup", queries },
      advisory_kind: null,
    });
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["financial_bridge_rejected"] };
  }

  return { ok: false, contract: null, errors: [`mixed_capability_families_not_executable:${families.join("+")}`] };
}
