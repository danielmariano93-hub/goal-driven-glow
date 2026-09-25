import { describe, expect, it } from "vitest";
import type { ConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";
import {
  TURN_SPEC_V3,
  type TaskTurnSpecV3,
  type TurnSpecV3,
  validateTurnSpecV3,
} from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";
import { verifySemanticInvariantsV3 } from "../../supabase/functions/_shared/agent/v3/SemanticInvariantsV3";
import { buildExecutionPlanV3 } from "../../supabase/functions/_shared/agent/v3/CapabilityRegistryV3";
import { adaptConversationTurnContractToV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3Adapter";
import {
  evidenceForTaskV3,
  validateEvidenceEnvelopeV3,
} from "../../supabase/functions/_shared/agent/v3/EvidenceEnvelopeV3";

const sourced = (value: string, source: "current_turn" | "memory" = "current_turn") => ({
  value,
  source,
  source_span: source === "current_turn" ? value : null,
} as const);

function financialTaskTurn(over: Partial<TaskTurnSpecV3> = {}): TaskTurnSpecV3 {
  return {
    version: TURN_SPEC_V3,
    kind: "task",
    response_intent: "execute",
    act: "new_request",
    canonical_request: "Quanto gastei em Lazer esse mês?",
    inherit_topic: false,
    references: [],
    tasks: [{
      kind: "financial_query",
      family: "financial.query",
      metric: "expense_amount",
      operation: "sum",
      group_by: [],
      filters: [{ field: "category", entity: sourced("Lazer") }],
      periods: [sourced("esse mês")],
      limit: null,
      comparison: null,
    }],
    ...over,
  };
}

function v2Base(over: Partial<ConversationTurnContract>): ConversationTurnContract {
  return {
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "read",
    domain: "financial_read",
    canonical_request: "Quais metas eu tenho?",
    inherit_focus: false,
    focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "not_applicable",
      entity: "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "lookup",
      queries: [{
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
      }],
    },
    advisory_kind: null,
    ...over,
  };
}

describe("Nino Runtime V3 foundation", () => {
  it("represents a valid financial query without independent mode/domain fields", () => {
    const turn = financialTaskTurn();
    expect(validateTurnSpecV3(turn)).toEqual({ ok: true, errors: [] });
    expect(turn.tasks[0]).toMatchObject({
      kind: "financial_query",
      family: "financial.query",
      filters: [{ field: "category", entity: { value: "Lazer", source: "current_turn" } }],
    });
  });

  it("rejects the impossible V2 read+conversation state that caused goal compiler_failed", () => {
    const invalid = v2Base({
      domain: "conversation",
      financial_read: null,
    });
    const adapted = adaptConversationTurnContractToV3(invalid, "Quais metas eu tenho?");
    expect(adapted).toEqual({
      ok: false,
      turn: null,
      errors: ["read_without_executable_domain:conversation"],
    });
  });

  it("maps goal overview to the stable goals capability family", () => {
    const adapted = adaptConversationTurnContractToV3(v2Base({}), "Quais metas eu tenho?");
    expect(adapted.ok).toBe(true);
    if (!adapted.ok || adapted.turn.kind !== "task") throw new Error("expected task turn");
    expect(adapted.turn.tasks).toEqual([
      expect.objectContaining({ kind: "goal_query", family: "goals", operation: "overview", goal: null }),
    ]);
    const plan = buildExecutionPlanV3(adapted.turn);
    expect(plan.tasks[0].capability).toMatchObject({ subsystem: "goal_engine", evidence_required: true });
  });

  it("forbids inherited category context from competing with an explicit current-turn category", () => {
    const turn = financialTaskTurn({
      inherit_topic: true,
      references: [{
        kind: "entity_reference",
        target: "category",
        expression: "ela",
        source: "memory",
      }],
    });
    const result = verifySemanticInvariantsV3(turn);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("explicit_category_conflicts_with_inherited_reference");
  });

  it("treats 'esse mês' as a period slot, not as a category reference", () => {
    const turn = financialTaskTurn();
    const result = verifySemanticInvariantsV3(turn);
    expect(result).toEqual({ ok: true, violations: [] });
    if (turn.kind !== "task" || turn.tasks[0].kind !== "financial_query") throw new Error("expected financial task");
    expect(turn.tasks[0].periods[0]).toMatchObject({ value: "esse mês", source: "current_turn" });
    expect(turn.references).toEqual([]);
  });

  it.each(["esse mês", "este mês", "neste mês", "mês atual", "hoje", "ontem"])(
    "rejects temporal phrase '%s' if any interpreter tries to use it as an entity reference",
    (expression) => {
      const turn = financialTaskTurn({
        references: [{
          kind: "entity_reference",
          target: "category",
          expression,
          source: "current_turn",
        }],
      });
      const result = verifySemanticInvariantsV3(turn);
      expect(result.ok).toBe(false);
      expect(result.violations).toContain("temporal_expression_used_as_category_reference");
    },
  );

  it("supports a compound request as multiple typed tasks from one semantic interpretation", () => {
    const turn: TurnSpecV3 = {
      ...financialTaskTurn(),
      canonical_request: "Quanto gastei em Lazer, compare com o mês passado e veja o impacto na minha meta.",
      tasks: [
        financialTaskTurn().tasks[0],
        {
          kind: "financial_query",
          family: "financial.query",
          metric: "expense_amount",
          operation: "compare",
          group_by: [],
          filters: [{ field: "category", entity: sourced("Lazer") }],
          periods: [sourced("este mês")],
          limit: null,
          comparison: {
            direction: "any",
            baseline: { kind: "period", period: sourced("mês passado") },
            target: sourced("este mês"),
          },
        },
        {
          kind: "goal_query",
          family: "goals",
          operation: "progress",
          goal: sourced("minha meta"),
        },
      ],
    };
    expect(validateTurnSpecV3(turn).ok).toBe(true);
    if (turn.kind !== "task") throw new Error("expected task turn");
    expect(buildExecutionPlanV3(turn).tasks.map((item) => item.capability.subsystem)).toEqual([
      "financial_ir",
      "financial_ir",
      "goal_engine",
    ]);
  });

  it("requires valid evidence before a task can contribute personal financial truth", () => {
    const valid = {
      version: "nino_evidence.v3" as const,
      task_index: 0,
      capability_family: "financial.query" as const,
      source: "financial_engine" as const,
      scope: { category: "Lazer", from: "2026-09-01", to: "2026-09-25" },
      payload: { total: 1345.88 },
      formula_version: "spending.v3",
      executed_at: "2026-09-25T16:00:00.000Z",
      query_fingerprint: "expense_amount/sum/category:Lazer/2026-09",
    };
    expect(validateEvidenceEnvelopeV3(valid).ok).toBe(true);
    expect(evidenceForTaskV3(0, [valid])).toHaveLength(1);
    expect(evidenceForTaskV3(1, [valid])).toHaveLength(0);
  });

  it("keeps legacy provenance quarantined to shadow adaptation", () => {
    const adapted = adaptConversationTurnContractToV3(v2Base({}), "Quais metas eu tenho?");
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(verifySemanticInvariantsV3(adapted.turn).ok).toBe(false);
    expect(verifySemanticInvariantsV3(adapted.turn, { allowLegacySource: true }).ok).toBe(true);
  });
});
