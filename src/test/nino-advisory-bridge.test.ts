import { describe, expect, it } from "vitest";
import { resolveBrainAdvisory } from "../../supabase/functions/_shared/agent/core/BrainAdvisoryBridge";
import type {
  AdvisoryKind,
  ConversationTurnContract,
} from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";

function read(
  request: string,
  advisory_kind: AdvisoryKind,
  focus: Partial<ConversationTurnContract["focus"]> = {},
): ConversationTurnContract {
  return {
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "read",
    domain: "advisory",
    advisory_kind,
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
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "not_applicable",
      entity: focus.goal ? "resolved" : "not_applicable",
      action: "not_applicable",
    },
    reference: null,
  };
}

describe("nino_advisory_bridge.v2", () => {
  it("binds next-best-action only from the Turn Contract subtype", () => {
    const out = resolveBrainAdvisory(read(
      "Qual é o meu próximo passo financeiro?",
      "next_best_action",
    ));
    expect(out?.capability).toMatchObject({
      name: "next_best_action",
      execution: "deterministic",
      required_tool: "get_next_best_action",
    });
  });

  it("binds explicit goal strategy using the Brain-resolved goal", () => {
    const out = resolveBrainAdvisory(read(
      "Como faço para bater minha meta de Reserva até dezembro?",
      "goal_strategy",
      { goal: "Reserva" },
    ));
    expect(out?.capability).toMatchObject({
      name: "goal_strategy",
      required_tool: "get_goal_strategy",
      tool_args: { goal: "Reserva" },
    });
  });

  it("binds wealth-building questions without reclassifying language", () => {
    const out = resolveBrainAdvisory(read(
      "Quanto consigo guardar por mês nos próximos 12 meses?",
      "wealth_opportunity",
    ));
    expect(out?.capability).toMatchObject({
      name: "wealth_opportunity",
      required_tool: "analyze_wealth_opportunity",
      tool_args: { months: 12 },
    });
  });

  it("binds an explicit plan target without asking the model to calculate it", () => {
    const out = resolveBrainAdvisory(read(
      "Monte um plano para eu juntar R$ 20 mil",
      "financial_plan",
    ));
    expect(out?.capability).toMatchObject({
      name: "financial_plan",
      required_tool: "build_financial_plan",
      tool_args: { target_amount: 20000 },
    });
  });

  it("does not semantically classify ordinary financial reads", () => {
    const ordinary: ConversationTurnContract = {
      ...read("Quais categorias eu mais gastei em julho e agosto?", "next_best_action"),
      domain: "financial_read",
      advisory_kind: null,
    };
    expect(resolveBrainAdvisory(ordinary)).toBeNull();
  });

  it("does not infer advisory subtype from wording when the contract omitted it", () => {
    const malformed: ConversationTurnContract = {
      ...read("Qual é o meu próximo passo financeiro?", "next_best_action"),
      advisory_kind: null,
    };
    expect(resolveBrainAdvisory(malformed)).toBeNull();
  });
});
