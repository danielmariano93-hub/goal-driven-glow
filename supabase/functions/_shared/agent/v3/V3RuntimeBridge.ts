// Nino Runtime V3 — deterministic bridge into the existing execution runtime.
//
// Transitional compatibility only. TurnSpecV3 remains the single semantic
// authority. Time is grounded HERE, once, before entering the mature V2
// execution engines. `period_expression` preserves the user's source wording
// for provenance/UI only; `period_expressions` carries canonical date windows
// used by execution and fulfillment. The V2 normalizer may validate this
// contract but may not rewrite the final V3 temporal scope.

import { isActionKind } from "../core/ActionIR.ts";
import {
  normalizeConversationTurnContract,
  type BrainFocus,
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

/**
 * "isso é muito comparado com o mês passado?" names only the baseline. The
 * evaluated window is then the task's own explicit period, or — when the
 * baseline is the previous calendar month — the current month to date. Any
 * other one-sided comparison stays unrepresentable and is rejected.
 */
function comparisonTargetPeriod(task: FinancialQueryTaskV3, now: Date): string | null {
  const explicit = canonicalPeriod(task.comparison?.target, now);
  if (explicit || task.operation !== "compare" || task.comparison?.baseline.kind !== "period") return explicit;
  const baseline = canonicalPeriod(task.comparison.baseline.period, now);
  if (!baseline) return null;
  const fromTask = task.periods.map((period) => canonicalPeriod(period, now)).find((value) => value && value !== baseline);
  if (fromTask) return fromTask;
  const previousMonth = canonicalPeriod({ value: "mês passado", source: "current_turn", source_span: "mês passado" } as PeriodExpressionV3, now);
  return baseline === previousMonth
    ? canonicalPeriod({ value: "este mês", source: "current_turn", source_span: "este mês" } as PeriodExpressionV3, now)
    : null;
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
      const target = comparisonTargetPeriod(task, now);
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

/**
 * A reading that asks for ONE number while also grouping it ("em quais
 * categorias eu gastei esse valor?" read as value + group_by=category) has a
 * single coherent meaning: split that amount by the dimension. Monthly grouping
 * is a series. Repairing the shape here keeps the user's meaning executable
 * instead of failing the turn on a structural technicality.
 */
export function coherentOperation(operation: string, groupBy: readonly string[]): string {
  const temporal = ["month", "day", "week", "quarter"].some((grain) => groupBy.includes(grain));
  if (temporal && ["value", "sum", "breakdown", "rank"].includes(operation)) return "trend";
  if ((operation === "value" || operation === "sum") && groupBy.length > 0) return "breakdown";
  return operation;
}

function financialQuery(task: FinancialQueryTaskV3, now: Date): FinancialReadSemanticQuery | null {
  const comparison = task.comparison;
  const baselineExpression = comparison?.baseline.kind === "period"
    ? canonicalPeriod(comparison.baseline.period, now)
    : null;
  const targetExpression = comparisonTargetPeriod(task, now);
  return {
    metric: task.metric,
    operation: coherentOperation(task.operation, task.group_by) as FinancialQueryTaskV3["operation"],
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

/**
 * V2 normalization is retained as structural validation only. It historically
 * merged/reordered period_expression + period_expressions; after validation we
 * restore the V3 temporal focus exactly so no downstream compatibility layer
 * can acquire semantic authority by rewriting it.
 */
function preserveV3TemporalFocus(
  contract: CanonicalConversationTurnContract | null,
  temporalFocus: BrainFocus,
): CanonicalConversationTurnContract | null {
  return contract ? { ...contract, focus: temporalFocus } : null;
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

export type V3RuntimeBridgeOptions = {
  /**
   * Extended advisory surface (scenario, decision, goal projection). When
   * false, new advisory operations degrade to the closest legacy engine so a
   * schema-widened interpreter never breaks users outside the rollout.
   */
  extended?: boolean;
};

const LEGACY_ADVISORY_FALLBACK: Record<string, string> = {
  scenario: "financial_plan",
  decision: "next_best_action",
  period_review: "current_insight",
};

function advisoryParamsOf(task: SemanticTaskV3): Record<string, unknown> | null {
  if (task.kind !== "advisory") return null;
  const params: Record<string, unknown> = {};
  if (task.scenario) params.scenario = task.scenario;
  if (task.options?.length) params.options = task.options;
  return Object.keys(params).length ? params : null;
}

/**
 * The dialogue act is the semantic signal; `inherit_topic` is a redundant flag
 * models sometimes leave inconsistent (e.g. follow_up + false). Deriving it
 * from the act keeps a coherent reading executable instead of rejecting it.
 */
function coherentInheritFocus(turn: TurnSpecV3): boolean {
  const act = String(turn.act);
  if (act === "follow_up" || act === "answer" || act === "repair") return true;
  if (act === "topic_switch") return false;
  return Boolean(turn.inherit_topic);
}

/**
 * Data-free body for a conversation turn whose model-written reply asserted a
 * personal financial fact without evidence. The composer writes the voice from
 * history; this is only delivered if composition is unavailable.
 */
export const V3_DATA_FREE_CONVERSATION_REPLY = "Tô por aqui com você. Se quiser, é só me pedir para olhar algum número.";

export function bridgeTurnSpecV3ToRuntime(
  turn: TurnSpecV3,
  now: Date = new Date(),
  options: V3RuntimeBridgeOptions = {},
): V3RuntimeBridgeResult {
  const invariant = verifySemanticInvariantsV3(turn);
  if (!invariant.ok) return { ok: false, contract: null, errors: invariant.violations };
  if (turn.references.length > 1) {
    return { ok: false, contract: null, errors: ["multiple_references_not_executable"] };
  }

  const temporal = buildTemporalContractV3(turn, now);
  if (!temporal.ok) return { ok: false, contract: null, errors: temporal.errors };

  const reference = runtimeReference(turn);

  if (turn.kind === "conversation") {
    const conversationContract = (directReply: string) => normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "converse",
      domain: "conversation",
      canonical_request: turn.canonical_request || null,
      inherit_focus: coherentInheritFocus(turn),
      focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
      action: null,
      direct_reply: directReply,
      clarification_question: null,
      resolution: { intent: "resolved", reference: reference ? "resolved" : "not_applicable", time: "not_applicable", entity: "not_applicable", action: "not_applicable" },
      reference,
      financial_read: null,
      advisory_kind: null,
    });
    // A reply that asserts an unevidenced personal number is dropped, not the
    // conversation: the turn stays conversational with a data-free body.
    const contract = conversationContract(turn.direct_reply) ?? conversationContract(V3_DATA_FREE_CONVERSATION_REPLY);
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["conversation_bridge_rejected"] };
  }

  if (turn.kind === "clarification") {
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "clarify",
      domain: "conversation",
      canonical_request: turn.canonical_request || null,
      inherit_focus: coherentInheritFocus(turn),
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
  const temporalFocus: BrainFocus = {
    ...focus,
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
    const contract = preserveV3TemporalFocus(normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "write",
      domain: "financial_write",
      canonical_request: turn.canonical_request,
      inherit_focus: coherentInheritFocus(turn),
      focus: temporalFocus,
      action: { action: task.action, slots: task.slots },
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: reference ? "resolved" : "not_applicable", time: periods.length ? "resolved" : "not_applicable", entity: focus.category || focus.merchant || focus.goal ? "resolved" : "not_applicable", action: "resolved" },
      reference,
      financial_read: null,
      advisory_kind: null,
    }), temporalFocus);
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["write_bridge_rejected"] };
  }

  if (families.length === 1 && families[0] === "advisory") {
    if (turn.tasks.length !== 1 || turn.tasks[0].kind !== "advisory") {
      return { ok: false, contract: null, errors: ["advisory_shape_not_executable"] };
    }
    const task = turn.tasks[0];
    const advisoryKind = options.extended
      ? task.operation
      : (LEGACY_ADVISORY_FALLBACK[task.operation] ?? task.operation);
    const contract = preserveV3TemporalFocus(normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "read",
      domain: "advisory",
      canonical_request: turn.canonical_request,
      inherit_focus: coherentInheritFocus(turn),
      focus: temporalFocus,
      action: null,
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: reference ? "resolved" : "not_applicable", time: periods.length ? "resolved" : "not_applicable", entity: "not_applicable", action: "not_applicable" },
      reference,
      financial_read: null,
      advisory_kind: advisoryKind,
      advisory_params: options.extended ? advisoryParamsOf(task) : null,
    }), temporalFocus);
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
    const contract = preserveV3TemporalFocus(normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: turn.act,
      mode: "read",
      domain: "financial_read",
      canonical_request: turn.canonical_request,
      inherit_focus: coherentInheritFocus(turn),
      focus: temporalFocus,
      action: null,
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: reference ? "resolved" : "not_applicable", time: periods.length ? "resolved" : "not_applicable", entity: focus.category || focus.merchant || focus.goal ? "resolved" : "not_applicable", action: "not_applicable" },
      reference,
      financial_read: { intent: queries.some((query) => ["compare", "trend", "explain"].includes(query.operation)) ? "analyze" : "lookup", queries },
      advisory_kind: null,
    }), temporalFocus);
    return contract ? { ok: true, contract, errors: [] } : { ok: false, contract: null, errors: ["financial_bridge_rejected"] };
  }

  return { ok: false, contract: null, errors: [`mixed_capability_families_not_executable:${families.join("+")}`] };
}

export type V3RuntimePlanResult =
  | { ok: true; contracts: [CanonicalConversationTurnContract, ...CanonicalConversationTurnContract[]]; errors: [] }
  | { ok: false; contracts: []; errors: string[] };

const MAX_PLAN_CONTRACTS = 4;

function goalProjectionContract(
  turn: TurnSpecV3,
  task: GoalQueryTaskV3,
  reference: TurnReference | null,
): CanonicalConversationTurnContract | null {
  const goal = task.goal?.value ?? null;
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: turn.act,
    mode: "read",
    domain: "advisory",
    canonical_request: turn.canonical_request,
    inherit_focus: coherentInheritFocus(turn),
    focus: { category: null, merchant: null, goal, period_expression: null, period_expressions: [] },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: reference ? "resolved" : "not_applicable",
      time: "not_applicable",
      entity: goal ? "resolved" : "not_applicable",
      action: "not_applicable",
    },
    reference,
    financial_read: null,
    advisory_kind: "goal_projection",
    advisory_params: goal ? { goal } : null,
  });
}

/**
 * Compound turns: one canonical interpretation can carry tasks of different
 * families ("quanto gastei com lazer e o que você sugere?"). Meaning is not
 * re-derived here — the TurnSpec is only partitioned into executable groups,
 * each bridged by the same deterministic rules as a single-family turn.
 * Execution order: mutation draft first (it needs confirmation), then facts,
 * then goal projections, then advice built on top of the facts.
 */
export function bridgeTurnSpecV3ToRuntimePlan(turn: TurnSpecV3, now: Date = new Date()): V3RuntimePlanResult {
  if (turn.kind !== "task") {
    const single = bridgeTurnSpecV3ToRuntime(turn, now, { extended: true });
    return single.ok
      ? { ok: true, contracts: [single.contract], errors: [] }
      : { ok: false, contracts: [], errors: single.errors };
  }
  const invariant = verifySemanticInvariantsV3(turn);
  if (!invariant.ok) return { ok: false, contracts: [], errors: invariant.violations };
  if (turn.references.length > 1) return { ok: false, contracts: [], errors: ["multiple_references_not_executable"] };

  const writes = turn.tasks.filter((task) => task.kind === "financial_write");
  const reads = turn.tasks.filter((task) =>
    task.kind === "financial_query" || (task.kind === "goal_query" && task.operation !== "projection")
  );
  const projections = turn.tasks.filter((task): task is GoalQueryTaskV3 =>
    task.kind === "goal_query" && task.operation === "projection"
  );
  const advisories = turn.tasks.filter((task) => task.kind === "advisory");

  const groups: SemanticTaskV3[][] = [];
  if (writes.length) groups.push(writes);
  if (reads.length) groups.push(reads);
  const singleGroup = groups.length + projections.length + advisories.length === 1;
  if (singleGroup && !projections.length) {
    const single = bridgeTurnSpecV3ToRuntime(turn, now, { extended: true });
    return single.ok
      ? { ok: true, contracts: [single.contract], errors: [] }
      : { ok: false, contracts: [], errors: single.errors };
  }

  const reference = runtimeReference(turn);
  const contracts: CanonicalConversationTurnContract[] = [];
  const errors: string[] = [];
  const bridgeSubset = (tasks: SemanticTaskV3[]) => {
    const sub = { ...turn, tasks: tasks as [SemanticTaskV3, ...SemanticTaskV3[]] } as TurnSpecV3;
    const bridged = bridgeTurnSpecV3ToRuntime(sub, now, { extended: true });
    if (bridged.ok) contracts.push(bridged.contract);
    else errors.push(...bridged.errors);
  };
  for (const group of groups) bridgeSubset(group);
  for (const projection of projections) {
    const contract = goalProjectionContract(turn, projection, reference);
    if (contract) contracts.push(contract);
    else errors.push("goal_projection_bridge_rejected");
  }
  for (const advisory of advisories) bridgeSubset([advisory]);

  if (errors.length) return { ok: false, contracts: [], errors: unique(errors) };
  if (!contracts.length) return { ok: false, contracts: [], errors: ["empty_plan"] };
  if (contracts.length > MAX_PLAN_CONTRACTS) return { ok: false, contracts: [], errors: ["too_many_plan_steps"] };
  return {
    ok: true,
    contracts: contracts as [CanonicalConversationTurnContract, ...CanonicalConversationTurnContract[]],
    errors: [],
  };
}
