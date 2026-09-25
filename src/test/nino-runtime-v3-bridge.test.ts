import { describe, expect, it } from "vitest";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import type { TurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";

const sourced = (value: string) => ({ value, source: "current_turn" as const, source_span: value });

function financialTurn(): TurnSpecV3 {
  return {
    version: "nino_turn_spec.v3",
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
  };
}

describe("Nino Runtime V3 -> existing runtime bridge", () => {
  it("preserves explicit category and period without reinterpreting them", () => {
    const result = bridgeTurnSpecV3ToRuntime(financialTurn());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract).toMatchObject({
      mode: "read",
      domain: "financial_read",
      focus: { category: "Lazer", period_expression: "esse mês" },
      financial_read: {
        queries: [{
          metric: "expense_amount",
          operation: "sum",
          filters: [{ field: "category", value: "Lazer" }],
        }],
      },
    });
  });

  it("maps goals overview to the existing goal_progress engine contract", () => {
    const turn: TurnSpecV3 = {
      version: "nino_turn_spec.v3",
      kind: "task",
      response_intent: "execute",
      act: "new_request",
      canonical_request: "Quais metas eu tenho?",
      inherit_topic: false,
      references: [],
      tasks: [{ kind: "goal_query", family: "goals", operation: "overview", goal: null }],
    };
    const result = bridgeTurnSpecV3ToRuntime(turn);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract.financial_read?.queries[0]).toMatchObject({ metric: "goal_progress", operation: "value" });
  });

  it("supports a compound financial + goals read under one canonical interpretation", () => {
    const base = financialTurn();
    if (base.kind !== "task") throw new Error("task expected");
    base.canonical_request = "Quanto gastei em Lazer e quais metas eu tenho?";
    base.tasks.push({ kind: "goal_query", family: "goals", operation: "overview", goal: null });
    const result = bridgeTurnSpecV3ToRuntime(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract.financial_read?.queries).toHaveLength(2);
  });

  it("fails closed instead of dropping an unsupported merchant filter", () => {
    const turn = financialTurn();
    if (turn.kind !== "task" || turn.tasks[0].kind !== "financial_query") throw new Error("task expected");
    turn.tasks[0].filters = [{ field: "merchant", entity: sourced("Mercado X") }];
    const result = bridgeTurnSpecV3ToRuntime(turn);
    expect(result).toMatchObject({ ok: false, contract: null, errors: ["task_not_executable:financial_query"] });
  });

  it("rejects arbitrary write action names before they reach draft tooling", () => {
    const turn: TurnSpecV3 = {
      version: "nino_turn_spec.v3",
      kind: "task",
      response_intent: "execute",
      act: "new_request",
      canonical_request: "faça algo",
      inherit_topic: false,
      references: [],
      tasks: [{ kind: "financial_write", family: "financial.write", action: "dangerous.arbitrary.action", slots: {} }],
    };
    const result = bridgeTurnSpecV3ToRuntime(turn);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.startsWith("unsupported_financial_write_action:"))).toBe(true);
  });

  it("fails closed for mixed advisory + financial execution until a canonical composite engine exists", () => {
    const turn = financialTurn();
    if (turn.kind !== "task") throw new Error("task expected");
    turn.tasks.push({ kind: "advisory", family: "advisory", operation: "next_best_action", periods: [] });
    const result = bridgeTurnSpecV3ToRuntime(turn);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("mixed_capability_families_not_executable");
  });
});
