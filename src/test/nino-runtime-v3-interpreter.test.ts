import { describe, expect, it } from "vitest";
import type { ConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";
import { normalizeSemanticInterpreterV3Output } from "../../supabase/functions/_shared/agent/v3/SemanticInterpreterV3";
import { evaluateRuntimeV3Shadow } from "../../supabase/functions/_shared/agent/v3/RuntimeV3Shadow";

function sourced(value: string) {
  return { value, source: "current_turn", source_span: value };
}

function rawFinancialTurn(over: Record<string, unknown> = {}) {
  return {
    version: "nino_turn_spec.v3",
    kind: "task",
    act: "topic_switch",
    canonical_request: "Quanto gastei em Lazer esse mês?",
    inherit_topic: false,
    references: [],
    tasks: [{
      kind: "financial_query",
      financial: {
        metric: "expense_amount",
        operation: "sum",
        group_by: [],
        filters: [{ field: "category", entity: sourced("Lazer") }],
        periods: [sourced("esse mês")],
        limit: null,
        comparison: null,
      },
      goal: null,
      advisory: null,
      write: null,
    }],
    direct_reply: null,
    clarification_question: null,
    ...over,
  };
}

function v2Goal(over: Partial<ConversationTurnContract> = {}): ConversationTurnContract {
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

describe("Nino Runtime V3 semantic interpreter", () => {
  it("normalizes an explicit Lazer/current-month request without inherited references", () => {
    const turn = normalizeSemanticInterpreterV3Output(rawFinancialTurn());
    expect(turn).toMatchObject({
      kind: "task",
      inherit_topic: false,
      references: [],
      tasks: [{
        kind: "financial_query",
        family: "financial.query",
        filters: [{ field: "category", entity: { value: "Lazer", source: "current_turn" } }],
        periods: [{ value: "esse mês", source: "current_turn" }],
      }],
    });
  });

  it("rejects a valid-shaped output that lets inherited category context compete with explicit Lazer", () => {
    const raw = rawFinancialTurn({
      inherit_topic: true,
      references: [{
        kind: "entity_reference",
        target: "category",
        expression: "ela",
        source: "memory",
      }],
    });
    expect(normalizeSemanticInterpreterV3Output(raw)).toBeNull();
  });

  it("rejects a temporal expression masquerading as a category reference even when JSON shape is valid", () => {
    const raw = rawFinancialTurn({
      references: [{
        kind: "entity_reference",
        target: "category",
        expression: "esse mês",
        source: "current_turn",
      }],
    });
    expect(normalizeSemanticInterpreterV3Output(raw)).toBeNull();
  });

  it("accepts compound tasks from one interpretation instead of reclassifying each sub-question", () => {
    const first = rawFinancialTurn().tasks[0];
    const raw = rawFinancialTurn({
      canonical_request: "Quanto gastei em Lazer, compare com o mês passado e mostre minhas metas?",
      tasks: [
        first,
        {
          kind: "financial_query",
          financial: {
            metric: "expense_amount",
            operation: "compare",
            group_by: [],
            filters: [{ field: "category", entity: sourced("Lazer") }],
            periods: [sourced("este mês"), sourced("mês passado")],
            limit: null,
            comparison: {
              direction: "any",
              baseline_kind: "period",
              baseline_period: sourced("mês passado"),
              baseline_months: null,
              target: sourced("este mês"),
            },
          },
          goal: null,
          advisory: null,
          write: null,
        },
        {
          kind: "goal_query",
          financial: null,
          goal: { operation: "overview", goal: null },
          advisory: null,
          write: null,
        },
      ],
    });
    const turn = normalizeSemanticInterpreterV3Output(raw);
    expect(turn?.kind).toBe("task");
    if (!turn || turn.kind !== "task") return;
    expect(turn.tasks.map((task) => task.family)).toEqual(["financial.query", "financial.query", "goals"]);
  });

  it("V2 shadow exposes the production-class impossible goal contract instead of repairing it", () => {
    const broken = v2Goal({ domain: "conversation", financial_read: null });
    expect(evaluateRuntimeV3Shadow(broken, "Quais metas eu tenho?")).toMatchObject({
      status: "rejected",
      violations: ["read_without_executable_domain:conversation"],
    });
  });

  it("V2 shadow maps a valid goal contract into the goal engine subsystem", () => {
    expect(evaluateRuntimeV3Shadow(v2Goal(), "Quais metas eu tenho?")).toMatchObject({
      status: "accepted",
      turn_kind: "task",
      task_families: ["goals"],
      execution_subsystems: ["goal_engine"],
      violations: [],
    });
  });
});
