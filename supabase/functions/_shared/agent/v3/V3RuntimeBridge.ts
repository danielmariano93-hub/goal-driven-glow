// Nino Runtime V3 — deterministic bridge into the existing execution runtime.
//
// This bridge does NOT interpret language. It translates an already validated
// TurnSpecV3 into the current ConversationTurnContract so the mature financial
// engines/draft workflows can be reused during canary. Unsupported mixed shapes
// fail closed instead of being approximated.

import { isActionKind } from "../core/ActionIR.ts";
import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
  type FinancialReadSemanticQuery,
} from "../core/ConversationTurnContract.ts";
import type {
  FinancialQueryTaskV3,
  GoalQueryTaskV3,
  SemanticTaskV3,
  TurnSpecV3,
} from "./TurnSpecV3.ts";
import { verifySemanticInvariantsV3 } from "./SemanticInvariantsV3.ts";

export type V3RuntimeBridgeResult =
  | { ok: true; contract: CanonicalConversationTurnContract; errors: [] }
  | { ok: false; contract: null; errors: string[] };

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function periodExpressions(tasks: SemanticTaskV3[]): string[] {
  const values: string[] = [];
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      values.push(...task.periods.map((p) => p.value));
      if (task.comparison?.baseline.kind === "period" && task.comparison.baseline.period?.value) {
        values.push(task.comparison.baseline.period.value);
      }
      if (task.comparison?.target?.value) values.push(task.comparison.target.value);
    }
    if (task.kind === "advisory") values.push(...task.periods.map((p) => p.value));
  }
  return unique(values.map((value) => value.trim()).filter(Boolean));
}

function financialQuery(task: FinancialQueryTaskV3): FinancialReadSemanticQuery | null {
  // Current FinancialQueryIR does not expose merchant as a generic filter.
  // Never silently drop it; V3 authority must wait for a canonical engine/IR
  // mapping for that shape.
  if (task.filters.some((filter) => filter.field === "merchant")) return null;
  const comparison = task.comparison;
  return {
    metric: task.metric,
    operation: task.operation,
    group_by: [...task.group_by],
    filters: task.filters.map((filter) => ({
      field: filter.field as "category" | "card" | "account" | "payment_method",
      op: "eq" as const,
      value: filter.entity.value,
    })),
    limit: task.limit,
    comparison_direction: comparison?.direction ?? "any",
    comparison_baseline: comparison?.baseline.kind ?? "period",
    comparison_baseline_window: comparison?.baseline.kind === "mean_previous_complete_months"
      ? comparison.baseline.months
      : null,
    comparison_baseline_expression: comparison?.baseline.kind === "period"
      ? comparison.baseline.period?.value ?? null
      : null,
    comparison_target_expression: comparison?.target?.value ?? null,
  };
}

function goalQuery(task: GoalQueryTaskV3): FinancialReadSemanticQuery | null {
  if (task.operation === "projection") {
    // Existing generic IR maps goal_progress value/sum; projection needs its
    // own canonical executor before V3 authority may expose it.
    return null;
  }
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

export function bridgeTurnSpecV3ToRuntime(turn: TurnSpecV3): V3RuntimeBridgeResult {
  const invariant = verifySemanticInvariantsV3(turn);
  if (!invariant.ok) return { ok: false, contract: null, errors: invariant.violations };

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
      resolution: { intent: "resolved", reference: "not_applicable", time: "not_applicable", entity: "not_applicable", action: "not_applicable" },
      reference: null,
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
      resolution: { intent: "ambiguous", reference: "not_applicable", time: "not_applicable", entity: "not_applicable", action: "not_applicable" },
      reference: null,
      financial_read: null,
      advisory_kind: null,
    });
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["clarification_bridge_rejected"] };
  }

  const families = unique(turn.tasks.map((task) => task.family));
  const periods = periodExpressions(turn.tasks);
  const focus = explicitFocus(turn.tasks);

  if (families.length === 1 && families[0] === "financial.write") {
    if (turn.tasks.length !== 1 || turn.tasks[0].kind !== "financial_write" || !isActionKind(turn.tasks[0].action)) {
      return { ok: false, contract: null, errors: ["write_shape_not_executable"] };
    }
    const task = turn.tasks[0];
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "write",
      domain: "financial_write",
      canonical_request: turn.canonical_request,
      inherit_focus: turn.inherit_topic,
      focus: { ...focus, period_expression: periods[0] ?? null, period_expressions: periods },
      action: { action: task.action, slots: task.slots },
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: "not_applicable", time: periods.length ? "resolved" : "not_applicable", entity: focus.category || focus.merchant || focus.goal ? "resolved" : "not_applicable", action: "resolved" },
      reference: null,
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
      focus: { ...focus, period_expression: periods[0] ?? null, period_expressions: periods },
      action: null,
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: "not_applicable", time: periods.length ? "resolved" : "not_applicable", entity: "not_applicable", action: "not_applicable" },
      reference: null,
      financial_read: null,
      advisory_kind: task.operation,
    });
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["advisory_bridge_rejected"] };
  }

  // Financial reads + goal reads can share the existing multi-query financial IR.
  if (families.every((family) => family === "financial.query" || family === "goals")) {
    if (turn.tasks.length > 4) return { ok: false, contract: null, errors: ["too_many_runtime_queries"] };
    const queries: FinancialReadSemanticQuery[] = [];
    for (const task of turn.tasks) {
      const query = task.kind === "financial_query"
        ? financialQuery(task)
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
      focus: { ...focus, period_expression: periods[0] ?? null, period_expressions: periods },
      action: null,
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: turn.references.length ? "resolved" : "not_applicable", time: periods.length ? "resolved" : "not_applicable", entity: focus.category || focus.merchant || focus.goal ? "resolved" : "not_applicable", action: "not_applicable" },
      reference: null,
      financial_read: { intent: queries.some((query) => ["compare", "trend", "explain"].includes(query.operation)) ? "analyze" : "lookup", queries },
      advisory_kind: null,
    });
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["financial_bridge_rejected"] };
  }

  return { ok: false, contract: null, errors: [`mixed_capability_families_not_executable:${families.join("+")}`] };
}
