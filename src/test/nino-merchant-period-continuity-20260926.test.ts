import { describe, expect, it } from "vitest";
import { normalizeConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract.ts";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter.ts";
import type { FinancialQueryIR } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR.ts";
import { readFileSync } from "node:fs";

function rawRead(overrides: Record<string, unknown> = {}) {
  return {
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "read",
    domain: "financial_read",
    canonical_request: "Quanto gastei em lazer?",
    inherit_focus: false,
    focus: {
      category: "Lazer",
      merchant: null,
      goal: null,
      period_expression: null,
      period_expressions: [],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "missing",
      entity: "resolved",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "lookup",
      queries: [{
        metric: "expense_amount",
        operation: "sum",
        group_by: [],
        filters: [{ field: "category", value: "Lazer" }],
        limit: null,
        comparison_direction: "any",
        comparison_baseline: "period",
        comparison_baseline_window: null,
        comparison_baseline_expression: null,
        comparison_target_expression: null,
      }],
    },
    advisory_kind: null,
    ...overrides,
  };
}

describe("Nino merchant + temporal continuity hardening", () => {
  it("treats omitted time in a factual financial read as backend-defaultable, not unresolved", () => {
    const contract = normalizeConversationTurnContract(rawRead());
    expect(contract).not.toBeNull();
    expect(contract?.mode).toBe("read");
    expect(contract?.resolution.time).toBe("not_applicable");
    expect(contract?.focus.period_expressions).toEqual([]);
  });

  it("still fails closed when the user actually supplied an ambiguous time", () => {
    const raw = rawRead({
      focus: {
        category: "Lazer",
        merchant: null,
        goal: null,
        period_expression: "naquela época",
        period_expressions: ["naquela época"],
      },
      resolution: {
        intent: "resolved",
        reference: "not_applicable",
        time: "ambiguous",
        entity: "resolved",
        action: "not_applicable",
      },
    });
    expect(normalizeConversationTurnContract(raw)).toBeNull();
  });

  it("accepts category + merchant simultaneously in the canonical turn contract", () => {
    const raw = rawRead({
      canonical_request: "Quanto gastei em lazer no estabelecimento Thales?",
      focus: {
        category: "Lazer",
        merchant: "Thales",
        goal: null,
        period_expression: null,
        period_expressions: [],
      },
      financial_read: {
        intent: "lookup",
        queries: [{
          metric: "expense_amount",
          operation: "sum",
          group_by: [],
          filters: [
            { field: "category", value: "Lazer" },
            { field: "merchant", value: "Thales" },
          ],
          limit: null,
          comparison_direction: "any",
          comparison_baseline: "period",
          comparison_baseline_window: null,
          comparison_baseline_expression: null,
          comparison_target_expression: null,
        }],
      },
    });
    const contract = normalizeConversationTurnContract(raw);
    expect(contract).not.toBeNull();
    expect(contract?.financial_read?.queries[0].filters).toEqual([
      { field: "category", op: "eq", value: "Lazer" },
      { field: "merchant", op: "eq", value: "Thales" },
    ]);
  });

  it("maps category + merchant lookup to the canonical merchant_profile engine without dropping either scope", () => {
    const ir: FinancialQueryIR = {
      version: "financial_query_ir.v1",
      intent: "lookup",
      needs_clarification: [],
      assumptions: [],
      queries: [{
        id: "q1",
        metric: "expense_amount",
        operation: "sum",
        group_by: [],
        filters: [
          { field: "category", op: "eq", value: "Lazer" },
          { field: "merchant", op: "eq", value: "Thales" },
        ],
        limit: null,
      }],
      completeness_targets: ["q1.money"],
      period: { from: "2026-09-01", to: "2026-09-26", label: "mês vigente" },
      comparison_period: null,
      source: "semantic_compiler",
      unsupported_reason: null,
    };
    const mapped = capabilityFromFinancialIR(ir);
    expect(mapped.unsupported_queries).toEqual([]);
    expect(mapped.capability?.required_tool).toBe("merchant_profile");
    expect(mapped.capability?.tool_args).toMatchObject({
      query: "Thales",
      category_name: "Lazer",
      from: "2026-09-01",
      to: "2026-09-26",
    });
  });

  it("keeps the V2 rescue before the clarify early-return and scopes merchant_profile by category", () => {
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    const engine = readFileSync("supabase/functions/_shared/agent/engineToolsImpl.ts", "utf8");
    const rescue = core.indexOf("applyLowRiskFinancialReadDefault(brain.contract, brainText)");
    const clarify = core.indexOf('if (contract.mode === "clarify")');
    expect(rescue).toBeGreaterThan(-1);
    expect(clarify).toBeGreaterThan(rescue);
    expect(engine).toContain("category_name?: string");
    expect(engine).toContain("categoryId,");
    expect(engine).toContain('throw new Error("category_not_found")');
  });
});
