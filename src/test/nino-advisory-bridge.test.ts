import { describe, expect, it } from "vitest";
import { resolveBrainAdvisory } from "../../supabase/functions/_shared/agent/core/BrainAdvisoryBridge";
import type { ConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";

function read(request: string, focus: Partial<ConversationTurnContract["focus"]> = {}): ConversationTurnContract {
  return {
    version: "conversation_turn_contract.v1",
    act: "new_request",
    mode: "read",
    canonical_request: request,
    inherit_focus: false,
    focus: {
      category: null,
      merchant: null,
      goal: null,
      period_expression: null,
      period_expressions: [],
      ...focus,
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    confidence: 0.98,
  };
}

describe("nino_advisory_bridge.v1", () => {
  it("routes holistic advice to the canonical next-best-action engine", () => {
    const out = resolveBrainAdvisory(read("Qual é o meu próximo passo financeiro?"));
    expect(out?.capability).toMatchObject({
      name: "next_best_action",
      execution: "deterministic",
      required_tool: "get_next_best_action",
    });
  });

  it("routes explicit goal strategy using the Brain-resolved goal", () => {
    const out = resolveBrainAdvisory(read(
      "Como faço para bater minha meta de Reserva até dezembro?",
      { goal: "Reserva" },
    ));
    expect(out?.capability).toMatchObject({
      name: "goal_strategy",
      required_tool: "get_goal_strategy",
      tool_args: { goal: "Reserva" },
    });
  });

  it("routes wealth-building questions to the canonical wealth engine", () => {
    const out = resolveBrainAdvisory(read("Quanto consigo guardar por mês nos próximos 12 meses?"));
    expect(out?.capability).toMatchObject({
      name: "wealth_opportunity",
      required_tool: "analyze_wealth_opportunity",
      tool_args: { months: 12 },
    });
  });

  it("binds an explicit plan target without asking the model to calculate it", () => {
    const out = resolveBrainAdvisory(read("Monte um plano para eu juntar R$ 20 mil"));
    expect(out?.capability).toMatchObject({
      name: "financial_plan",
      required_tool: "build_financial_plan",
      tool_args: { target_amount: 20000 },
    });
  });

  it("does not hijack ordinary financial reads or social conversation", () => {
    expect(resolveBrainAdvisory(read("Quais categorias eu mais gastei em julho e agosto?"))).toBeNull();
    expect(resolveBrainAdvisory({
      ...read("O que você acha?"),
      mode: "converse",
      direct_reply: "Acho que vale olhar isso com calma.",
      canonical_request: null,
    })).toBeNull();
  });
});
