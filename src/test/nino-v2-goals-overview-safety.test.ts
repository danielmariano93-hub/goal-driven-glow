import { describe, expect, it } from "vitest";
import { resolveNarrowDeterministicTurn } from "../../supabase/functions/_shared/agent/core/NarrowDeterministicGate";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";

describe("V2 goals overview safety lane", () => {
  it.each([
    "Quais metas eu tenho?",
    "Mostre minhas metas",
    "Me mostre minhas metas",
    "Como estão minhas metas?",
  ])("emits the canonical executable goal_progress read: %s", (text) => {
    const turn = resolveNarrowDeterministicTurn(text);
    expect(turn).toMatchObject({
      mode: "read",
      domain: "financial_read",
      financial_read: {
        queries: [{ metric: "goal_progress", operation: "value" }],
      },
    });
    const compiled = compileFinancialReadFromTurn({
      turn: turn!,
      period: { from: "2026-09-01", to: "2026-09-25", label: "este mês" },
    });
    expect(compiled?.ir).not.toBeNull();
    expect(capabilityFromFinancialIR(compiled!.ir!).capability).toMatchObject({
      name: "goals_overview",
      required_tool: "get_goals_overview",
    });
  });

  it("does not steal a scoped goal question that needs semantic interpretation", () => {
    expect(resolveNarrowDeterministicTurn("Como está minha meta de viagem?" )).toBeNull();
  });
});
