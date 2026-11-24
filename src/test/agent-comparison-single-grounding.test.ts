import { describe, expect, it } from "vitest";
import { groundComparisonTurn, independentMonthComparison, scopeForSingleComparison } from "../../supabase/functions/_shared/agent/core/IndependentTemporalOracle";
import { buildFinancialReadContract, validateFinancialReadContract } from "../../supabase/functions/_shared/agent/core/FinancialReadContract";
import { verifyExecutedFinancialScopes } from "../../supabase/functions/_shared/agent/core/ExecutionScopeGate";
import type { CanonicalConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";
import type { FinancialQueryIRv3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";

const today = "2026-11-24";
const current = { from: "2026-11-01", to: today };
const same = { from: "2026-10-01", to: "2026-10-24" };
const full = { from: "2026-10-01", to: "2026-10-31" };
const period = (w: { from: string; to: string }) => `${w.from}..${w.to}`;
const modelTurn = (first: typeof current, second: typeof current): CanonicalConversationTurnContract => ({
  version: "conversation_turn_contract.v2", act: "new_request", mode: "read", domain: "financial_read",
  canonical_request: null, inherit_focus: false, action: null, direct_reply: null, clarification_question: null,
  reference: null, advisory_kind: null,
  focus: { category: "Lazer", merchant: null, goal: null,
    period_expression: period(first), period_expressions: [period(first), period(second)] },
  resolution: { intent: "resolved", time: "resolved", reference: "not_applicable", entity: "resolved", action: "not_applicable" },
  financial_read: { intent: "analyze", queries: [{
    metric: "expense_amount", operation: "compare", group_by: [],
    filters: [{field: "category",op: "eq",value: "Lazer"}], limit: null,
    comparison_baseline: "period", comparison_direction: "any",
    comparison_baseline_expression: "mês passado", comparison_target_expression: "esse mês",
  }] },
});
function ir(target: typeof current, baseline: typeof current): FinancialQueryIRv3 {
  return {
    version: "financial_query_ir.v3", intent: "analyze", period: target, comparison_period: baseline,
    queries: [{
      id: "q1", metric: "expense_amount", legacy_operation: "compare", operation: "compare",
      group_by: [], filters: [{ field: "category", op: "eq", value: "Lazer" }],
      limit: null, comparison_direction: "any", comparison_baseline: "period",
      comparison_baseline_window: null, time: { ...target, aspect: "period", grain: "none" },
    }],
  } as unknown as FinancialQueryIRv3;
}

describe("one-pass temporal grounding instead of post-hoc rejection", () => {
  for (const [question, expectedBaseline] of [
    ["como estou esse mês comparado com o mesmo período do mês anterior?", same],
    ["tô gastando mais ou menos que no mês passado, até agora?", same],
    ["compara o que gastei esse mês até agora com outubro inteiro", full],
  ] as const) {
    it(`gives same execution independently of the model's flipped time role: ${question}`, () => {
      const expected = independentMonthComparison(question, today);
      expect(expected).not.toBeNull();
      expect(expected!.target).toEqual(current);
      expect(expected!.baseline).toEqual(expectedBaseline);
      for (const turn of [modelTurn(full, current), modelTurn(current, full)]) {
        const grounded = groundComparisonTurn(turn, expected!);
        expect(grounded.focus.period_expressions).toEqual([period(expectedBaseline), period(current)]);
        expect(grounded.focus.period_expression).toEqual(period(current));
        expect(grounded.financial_read).toEqual(turn.financial_read);
        expect(grounded.focus.category).toBe("Lazer");
        const contract = buildFinancialReadContract({ turn: grounded, requested: ir(current, expectedBaseline) });
        expect(validateFinancialReadContract(contract)).toEqual([]);
        expect(verifyExecutedFinancialScopes(contract, [
          { tool_name: "compare_periods", ok: true, args: { period_a: current, period_b: expectedBaseline } },
        ], { requested_text: question, reference_date: today })).toEqual([]);
      }
    });
  }
  it("does not ground ambiguous ranges or explicit unrelated months", () => {
    for (const question of ["compara setembro com agosto", "compara esse mês do dia 1 ao dia 10 com outubro",
      "quanto gastei mês passado", "compara novembro inteiro com outubro"]) {
      expect(independentMonthComparison(question, today)).toBeNull();
    }
  });
  it("rejects non-comparison and compound scopes without changing user intent", () => {
    const turn = modelTurn(full, current);
    const text = "como estou esse mês comparado com o mesmo período do mês anterior?";
    expect(scopeForSingleComparison(turn, text, today)?.baseline).toEqual(same);
    const compound = { ...turn, financial_read: { ...turn.financial_read!,
      queries: [...turn.financial_read!.queries, { ...turn.financial_read!.queries[0], operation: "sum" as const }] } };
    expect(scopeForSingleComparison(compound, text, today)).toBeNull();
    expect(scopeForSingleComparison({ ...turn, mode: "write" }, text, today)).toBeNull();
    const sum = { ...turn, financial_read: { ...turn.financial_read!, queries: [
      { ...turn.financial_read!.queries[0], operation: "sum" as const }] } };
    expect(scopeForSingleComparison(sum, text, today)).toBeNull();
  });
  it("only performs structural grounding, not financial calculations or writes", () => {
    const input = modelTurn(full, current);
    const original = JSON.stringify(input);
    const s = independentMonthComparison("como estou esse mês comparado com o mesmo período do mês anterior?", today)!;
    const grounded = groundComparisonTurn(input, s);
    expect(JSON.stringify(input)).toEqual(original);
    expect(grounded.action).toBeNull();
    expect(grounded.financial_read).toEqual(input.financial_read);
  });
});
