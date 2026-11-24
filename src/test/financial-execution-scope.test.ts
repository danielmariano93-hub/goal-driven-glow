import { describe, expect, it } from "vitest";
import { verifyExecutedFinancialScopes } from "../../supabase/functions/_shared/agent/core/ExecutionScopeGate";
import { verifyFinancialFulfillment } from "../../supabase/functions/_shared/agent/core/ContractFulfillmentGate";
import type { FinancialReadContractV4 } from "../../supabase/functions/_shared/agent/core/FinancialReadContract";

const current = { from: "2026-11-01", to: "2026-11-24" };
const previous = { from: "2026-10-01", to: "2026-10-24" };
const full = { from: "2026-10-01", to: "2026-10-31" };
const contract = {
  version: "financial_read_contract.v4",
  source_turn_version: "conversation_turn_contract.v2",
  domain: "financial_read",
  requested: {
    version: "financial_query_ir.v3", intent: "analyze", period: current,
    comparison_period: previous,
    queries: [{ legacy_operation: "compare", metric: "expense_amount", group_by: [], filters: [], time: current }],
  },
  semantic_request: null,
  semantic_periods: [],
  slots: { intent: "resolved", reference: "not_applicable", time: "resolved", entity: "not_applicable" },
  grounded_reference: null,
} as unknown as FinancialReadContractV4;
const tool = (period_a: unknown, period_b: unknown, result?: unknown) => ({
  tool_name: "compare_periods", ok: true, args: { period_a, period_b }, result,
});

describe("financial execution-scope proof", () => {
  it("matches exact windows independent of argument order", () => {
    expect(verifyExecutedFinancialScopes(contract, [tool(current, previous)])).toEqual([]);
    expect(verifyExecutedFinancialScopes(contract, [tool(previous, current)])).toEqual([]);
  });
  it("rejects a full month substituted for the partial previous month", () => {
    expect(verifyExecutedFinancialScopes(contract, [tool(current, full)])[0].code)
      .toBe("comparison_execution_window_mismatch");
  });
  it("rejects another month or a missing date even with plausible numbers", () => {
    expect(verifyExecutedFinancialScopes(contract, [tool(current, { from: "2026-09-01", to: "2026-09-24" })])).toHaveLength(1);
    expect(verifyExecutedFinancialScopes(contract, [tool(current, { from: "2026-10-01" })])).toHaveLength(1);
  });
  it("rejects a result whose declared window changed after execution", () => {
    expect(verifyExecutedFinancialScopes(contract, [tool(current, previous, { period_a: current, period_b: full })])[0].code)
      .toBe("comparison_result_window_mismatch");
  });
  it("rejects one bad call in a sequence containing a correct call", () => {
    expect(verifyExecutedFinancialScopes(contract, [tool(current, previous), tool(current, full)])).toHaveLength(1);
  });
  it("rejects ungrounded IR scope instead of assuming it is valid", () => {
    const noBaseline = { ...contract, requested: { ...contract.requested, comparison_period: null } } as FinancialReadContractV4;
    expect(verifyExecutedFinancialScopes(noBaseline, [tool(current, previous)])[0].code).toBe("comparison_scope_unverifiable");
  });
  it("does not intercept other financial tools or unrelated reads", () => {
    expect(verifyExecutedFinancialScopes(contract, [{ tool_name: "sum_expenses", ok: true, args: {} }])).toEqual([]);
  });
  it("blocks the final response when the comparison execution diverges", () => {
    const result = verifyFinancialFulfillment({
      contract, preservation: null, grounding: null,
      tool_calls: [tool(current, full)],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map(v => v.code)).toContain("comparison_execution_window_mismatch");
  });
});
