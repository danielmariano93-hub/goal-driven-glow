import { describe, expect, it } from "vitest";
import { resolveNarrowDeterministicTurn } from "../../supabase/functions/_shared/agent/core/NarrowDeterministicGate";
import { applyImplicitPeriodToClarification, resolveImplicitPeriod } from "../../supabase/functions/_shared/agent/core/ImplicitPeriodPolicy";
import { normalizeConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import { executedIRFrom } from "../../supabase/functions/_shared/agent/core/ExecutedIRBridge";
import type { FinancialQueryIR } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";
import type { FinancialQueryV3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import type { TurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";

const period = { from: "2026-09-01", to: "2026-09-26", label: "setembro até hoje" };

function ir(filters: FinancialQueryIR["queries"][number]["filters"], metric: "expense_amount" | "income_amount" = "expense_amount"): FinancialQueryIR {
  return {
    version: "financial_query_ir.v1",
    intent: "lookup",
    needs_clarification: [],
    assumptions: [],
    queries: [{ id: "q1", metric, operation: "sum", group_by: [], filters, limit: null }],
    completeness_targets: ["q1.money"],
    period,
    comparison_period: null,
    source: "semantic_compiler",
    unsupported_reason: null,
  };
}

describe("merchant + category contract and implicit-period policy", () => {
  it.each([
    ["Quanto gastei em lazer?", [{ field: "category", op: "eq", value: "Lazer" }]],
    ["Nino quanto gastei no estabelecimento Thales", [{ field: "merchant", op: "eq", value: "Thales" }]],
    [
      "Nino quanto gastei em lazer no estabelecimento Thales",
      [
        { field: "category", op: "eq", value: "Lazer" },
        { field: "merchant", op: "eq", value: "Thales" },
      ],
    ],
  ])("emits the canonical closed-grammar lookup for %s", (text, filters) => {
    const turn = resolveNarrowDeterministicTurn(text);
    expect(turn).toMatchObject({
      mode: "read",
      domain: "financial_read",
      resolution: { time: "not_applicable" },
      financial_read: { queries: [{ metric: "expense_amount", operation: "sum", filters }] },
    });
  });

  it("does not swallow explicit periods or unknown qualifiers", () => {
    expect(resolveNarrowDeterministicTurn("Quanto gastei em lazer em agosto?")).toBeNull();
    expect(resolveNarrowDeterministicTurn("Quanto gastei com o pessoal?")).toBeNull();
  });

  it("applies explicit > active > last related > current month", () => {
    const current = { from: "2026-09-01", to: "2026-09-26", label: "este mês" };
    const last = { from: "2026-07-01", to: "2026-07-31", label: "julho" };
    const active = { from: "2026-08-01", to: "2026-08-31", label: "agosto" };
    const explicit = { from: "2026-06-01", to: "2026-06-30", label: "junho" };

    expect(resolveImplicitPeriod({ explicit, active, last_related: last, current_month: current })).toMatchObject({ source: "explicit_turn", period: explicit });
    expect(resolveImplicitPeriod({ active, last_related: last, current_month: current })).toMatchObject({ source: "active_conversation", period: active });
    expect(resolveImplicitPeriod({ last_related: last, current_month: current })).toMatchObject({ source: "last_related_result", period: last });
    expect(resolveImplicitPeriod({ current_month: current })).toMatchObject({ source: "current_month", period: current });
  });

  it("promotes a period-only Brain clarification when the financial meaning is already complete", () => {
    const clarified = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: "new_request",
      mode: "clarify",
      domain: "financial_read",
      canonical_request: "Quanto gastei em lazer?",
      inherit_focus: false,
      focus: { category: "Lazer", merchant: null, goal: null, period_expression: null, period_expressions: [] },
      action: null,
      direct_reply: null,
      clarification_question: "De qual período você quer saber?",
      resolution: { intent: "ambiguous", reference: "not_applicable", time: "missing", entity: "resolved", action: "not_applicable" },
      reference: null,
      financial_read: {
        intent: "lookup",
        queries: [{ metric: "expense_amount", operation: "sum", group_by: [], filters: [{ field: "category", value: "Lazer" }], limit: null }],
      },
      advisory_kind: null,
    });
    expect(clarified).not.toBeNull();
    const promoted = applyImplicitPeriodToClarification(clarified!, "Quanto gastei em lazer?");
    expect(promoted).toMatchObject({
      mode: "read",
      clarification_question: null,
      resolution: { intent: "resolved", time: "not_applicable", entity: "resolved" },
    });
  });

  it("keeps real entity and comparison ambiguities fail-closed", () => {
    const base = resolveNarrowDeterministicTurn("Quanto gastei em lazer?")!;
    const entityAmbiguous = {
      ...base,
      mode: "clarify" as const,
      clarification_question: "Qual categoria?",
      resolution: { ...base.resolution, intent: "ambiguous" as const, time: "missing" as const, entity: "ambiguous" as const },
    };
    expect(applyImplicitPeriodToClarification(entityAmbiguous, base.canonical_request!)).toBe(entityAmbiguous);

    const comparisonAmbiguous = {
      ...base,
      mode: "clarify" as const,
      clarification_question: "Qual período comparar?",
      resolution: { ...base.resolution, intent: "ambiguous" as const, time: "missing" as const },
      financial_read: { ...base.financial_read!, queries: [{ ...base.financial_read!.queries[0], operation: "compare" as const }] },
    };
    expect(applyImplicitPeriodToClarification(comparisonAmbiguous, base.canonical_request!)).toBe(comparisonAmbiguous);
  });

  it("maps merchant-only and category+merchant lookups to merchant_profile without losing scope", () => {
    const merchantOnly = capabilityFromFinancialIR(ir([{ field: "merchant", op: "eq", value: "Thales" }]));
    expect(merchantOnly).toMatchObject({
      unsupported_queries: [],
      capability: { required_tool: "merchant_profile", tool_args: { query: "Thales", from: period.from, to: period.to } },
    });

    const combined = capabilityFromFinancialIR(ir([
      { field: "category", op: "eq", value: "Lazer" },
      { field: "merchant", op: "eq", value: "Thales" },
    ]));
    expect(combined).toMatchObject({
      unsupported_queries: [],
      capability: { required_tool: "merchant_profile", tool_args: { query: "Thales", category_name: "Lazer" } },
    });
  });

  it("fails closed for an unsupported income + merchant combination", () => {
    const mapped = capabilityFromFinancialIR(ir([{ field: "merchant", op: "eq", value: "Thales" }], "income_amount"));
    expect(mapped.capability).toBeNull();
    expect(mapped.unsupported_queries).toEqual(["q1"]);
  });

  it("reconstructs both filters from the actual merchant_profile result", () => {
    const requested: FinancialQueryV3 = {
      id: "q1",
      metric: "expense_amount",
      legacy_operation: "sum",
      filters: [
        { field: "category", op: "eq", value: "Lazer" },
        { field: "merchant", op: "eq", value: "Thales" },
      ],
      time: { aspect: "mtd", from: period.from, to: period.to, n: null, exclude_partial: false, label: period.label },
      grain: "none",
      reduce: "sum",
      group_by: [],
      limit: null,
      depends_on: [],
    };
    const executed = executedIRFrom(requested, {
      engine: "merchant_profile",
      total_metric: 123.45,
      period: { from: period.from, to: period.to },
      filters: { category: "Lazer", merchant: "Thales" },
    });
    expect(executed).toMatchObject({
      metric: "expense_amount",
      filters: [
        { field: "category", value: "Lazer" },
        { field: "merchant", value: "Thales" },
      ],
      time: { from: period.from, to: period.to },
    });
  });

  it("keeps category + merchant in the V3 bridge", () => {
    const sourced = (value: string) => ({ value, source: "current_turn" as const, source_span: value });
    const turn: TurnSpecV3 = {
      version: "nino_turn_spec.v3",
      kind: "task",
      response_intent: "execute",
      act: "new_request",
      canonical_request: "Quanto gastei em lazer no estabelecimento Thales?",
      inherit_topic: false,
      references: [],
      tasks: [{
        kind: "financial_query",
        family: "financial.query",
        metric: "expense_amount",
        operation: "sum",
        group_by: [],
        filters: [
          { field: "category", entity: sourced("Lazer") },
          { field: "merchant", entity: sourced("Thales") },
        ],
        periods: [],
        limit: null,
        comparison: null,
      }],
    };
    const bridged = bridgeTurnSpecV3ToRuntime(turn);
    expect(bridged.ok).toBe(true);
    if (!bridged.ok) return;
    expect(bridged.contract.financial_read?.queries[0].filters.map((filter) => filter.field)).toEqual(["category", "merchant"]);
  });
});
