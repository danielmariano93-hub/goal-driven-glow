import { describe, expect, it } from "vitest";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import type { FinancialQueryIR } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";
import { topicScore, keywordsOf, type TopicThread } from "../../supabase/functions/_shared/agent/core/TopicRepository";
import { normalizeConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";
import { resolveBrainAdvisory } from "../../supabase/functions/_shared/agent/core/BrainAdvisoryBridge";
import { structuredContinuationContract } from "../../supabase/functions/_shared/agent/core/StructuredContinuation";
import { resolveGroundedComparisonFollowup } from "../../supabase/functions/_shared/agent/core/GroundedComparisonFollowup";
import { emptyMemory } from "../../supabase/functions/_shared/agent/core/ConversationMemory";

const period = { from: "2026-09-01", to: "2026-09-18", label: "este mês" };
const previous = { from: "2026-08-01", to: "2026-08-18", label: "período anterior equivalente" };

function comparisonIR(filterField: "category" | "card" | null = null): FinancialQueryIR {
  return {
    version: "financial_query_ir.v1",
    intent: "analyze",
    needs_clarification: [],
    assumptions: [],
    queries: [{
      id: "q1",
      metric: "expense_amount",
      operation: "compare",
      group_by: [],
      filters: filterField ? [{ field: filterField, op: "eq", value: filterField === "category" ? "Lazer" : "Nubank" }] : [],
      limit: null,
      comparison_direction: "any",
      comparison_baseline: "period",
      comparison_baseline_window: null,
    }],
    completeness_targets: ["q1.result"],
    period,
    comparison_period: previous,
    source: "semantic_compiler",
    unsupported_reason: null,
  };
}

function topic(over: Partial<TopicThread> = {}): TopicThread {
  return {
    id: "t1",
    user_id: "u1",
    conversation_id: "c1",
    subject: "comparacao:categorias",
    title: "Categorias acima da média",
    summary: null,
    status: "answered",
    keywords: keywordsOf("categorias acima média meses"),
    entities: [],
    acts: [],
    period_from: null,
    period_to: null,
    original_query: "Quais categorias ficaram acima da média dos últimos 2 meses?",
    last_query: "Quanto gastei em Lazer neste mês?",
    evidence_reference: null,
    execution_summary: null,
    turn_count: 8,
    opened_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    ...over,
  };
}

function converse(raw: Partial<Record<string, unknown>> = {}) {
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "converse",
    domain: "conversation",
    canonical_request: null,
    inherit_focus: false,
    focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
    action: null,
    direct_reply: "Certo.",
    clarification_question: null,
    resolution: {
      intent: "resolved", reference: "not_applicable", time: "not_applicable",
      entity: "not_applicable", action: "not_applicable",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
    ...raw,
  });
}

describe("nino root-cause generalization", () => {
  it("executes category-scoped period comparison instead of false unsupported", () => {
    const out = capabilityFromFinancialIR(comparisonIR("category"));
    expect(out.unsupported_queries).toEqual([]);
    expect(out.capability?.required_tool).toBe("compare_periods");
    expect(out.capability?.tool_args).toMatchObject({ category_scope: ["Lazer"] });
  });

  it("keeps unsupported filters fail-closed", () => {
    const out = capabilityFromFinancialIR(comparisonIR("card"));
    expect(out.capability).toBeNull();
    expect(out.unsupported_queries).toEqual(["q1"]);
  });

  it("supports category scope for historical-mean comparisons too", () => {
    const value = comparisonIR("category");
    value.queries[0].comparison_baseline = "mean_previous_complete_months";
    value.queries[0].comparison_baseline_window = 3;
    const out = capabilityFromFinancialIR(value);
    expect(out.capability?.required_tool).toBe("compare_to_monthly_average");
    expect(out.capability?.tool_args).toMatchObject({ category_scope: ["Lazer"], months: 3 });
  });

  it("does not let last_query rename a durable topic", () => {
    const drifted = topic();
    expect(topicScore("Quanto gastei em Lazer neste mês?", drifted)).toBe(0);
    expect(topicScore("Quais categorias ficaram acima da média?", drifted)).toBeGreaterThan(0);
  });

  it("blocks personal financial assertions from any ungrounded converse act", () => {
    const invalid = converse({
      direct_reply: "Hoje, seu gasto em Vestuário está ligeiramente acima da média.",
    });
    expect(invalid).toBeNull();
  });

  it("keeps ordinary non-personal conversation valid", () => {
    expect(converse({ direct_reply: "Posso explicar o conceito de média e variação." })).not.toBeNull();
  });

  it("routes daily insight to the daily evidence engine", () => {
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: "new_request",
      mode: "read",
      domain: "advisory",
      canonical_request: "Qual insight você tem para hoje?",
      inherit_focus: false,
      focus: { category: null, merchant: null, goal: null, period_expression: "hoje", period_expressions: ["hoje"] },
      action: null,
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: "not_applicable", time: "resolved", entity: "not_applicable", action: "not_applicable" },
      reference: null,
      financial_read: null,
      advisory_kind: "current_insight",
    })!;
    expect(resolveBrainAdvisory(contract)?.capability).toMatchObject({
      name: "insights", required_tool: "get_daily_insights",
    });
  });

  it("routes current-month insight to factual spending highlights", () => {
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: "new_request",
      mode: "read",
      domain: "advisory",
      canonical_request: "Qual insight você tem sobre o mês atual?",
      inherit_focus: false,
      focus: { category: null, merchant: null, goal: null, period_expression: "mês atual", period_expressions: ["mês atual"] },
      action: null,
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: "not_applicable", time: "resolved", entity: "not_applicable", action: "not_applicable" },
      reference: null,
      financial_read: null,
      advisory_kind: "current_insight",
    })!;
    expect(resolveBrainAdvisory(contract)?.capability).toMatchObject({
      name: "insights", required_tool: "get_spending_highlights",
    });
  });

  it("compiles accepted comparison offer directly from structured state", () => {
    const memory = {
      ...emptyMemory(),
      active_category: "Lazer",
      active_period: period,
      pending_conversation_action: {
        action_type: "financial_comparison" as const,
        requested_operation: {
          metric: "expense",
          comparison_mode: "MTD_EQUIVALENT",
          restated_request: "Se quiser, eu comparo esse valor com o período anterior e mostro o que mais mudou.",
        },
        confirmation_expected: true as const,
        accepted_answers: ["sim", "faz"],
        asked_at: "2026-09-18T18:00:00.000Z",
        expires_at: "2026-09-19T00:00:00.000Z",
      },
    };
    const contract = structuredContinuationContract(memory.pending_conversation_action, memory);
    expect(contract).toMatchObject({
      mode: "read",
      domain: "financial_read",
      focus: { category: "Lazer" },
      financial_read: {
        queries: [{ operation: "compare", filters: [{ field: "category", op: "eq", value: "Lazer" }] }],
      },
    });
  });

  it("provider-independent continuation path intercepts the internal accepted-offer prompt", () => {
    const memory = {
      ...emptyMemory(),
      active_category: "Lazer",
      active_period: period,
      pending_conversation_action: {
        action_type: "financial_comparison" as const,
        requested_operation: {
          metric: "expense",
          comparison_mode: "MTD_EQUIVALENT",
          restated_request: "Se quiser, eu comparo esse valor com o período anterior.",
        },
        confirmation_expected: true as const,
        accepted_answers: ["sim"],
        asked_at: "2026-09-18T18:00:00.000Z",
        expires_at: "2026-09-19T00:00:00.000Z",
      },
    };
    const contract = resolveGroundedComparisonFollowup(
      "Sim, faça isso: Se quiser, eu comparo esse valor com o período anterior.",
      memory,
    );
    expect(contract?.financial_read?.queries[0]).toMatchObject({
      metric: "expense_amount",
      operation: "compare",
      filters: [{ field: "category", op: "eq", value: "Lazer" }],
    });
  });
});
