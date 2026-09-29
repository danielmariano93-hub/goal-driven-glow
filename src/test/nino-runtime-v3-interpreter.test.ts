import { describe, expect, it } from "vitest";
import { normalizeSemanticInterpreterV3Output } from "../../supabase/functions/_shared/agent/v3/SemanticInterpreterV3";

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
});
