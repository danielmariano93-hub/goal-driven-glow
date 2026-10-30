import { describe, expect, it } from "vitest";
import { lastNormalizeFailure, normalizeSemanticInterpreterV3Output } from "../../supabase/functions/_shared/agent/v3/SemanticInterpreterV3";
import { contractRepairHint } from "../../supabase/functions/_shared/agent/core/SelfRepair";

const period = (value: string) => ({ value, source: "current_turn", source_span: value });
const turn = (comparison: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  version: "nino_turn_spec.v3", act: "follow_up", kind: "task", canonical_request: "compare com o mês passado",
  inherit_topic: true, references: [], direct_reply: null, clarification_question: null,
  tasks: [{ kind: "financial_query", financial: {
    metric: "expense_amount", operation: "compare", group_by: ["category"], filters: [], periods: [period("outubro")],
    limit: null, unavailable_dimension: null, comparison, ...extra,
  }, goal: null, advisory: null, write: null }],
});

describe("saída do interpretador que o validador recusava", () => {
  it("base por período com baseline_months preenchido à toa vale como comparação por período", () => {
    const out = normalizeSemanticInterpreterV3Output(turn({
      direction: "any", baseline_kind: "period", baseline_period: period("mês passado"), baseline_months: 1, target: null,
    })) as any;
    expect(out).not.toBeNull();
    expect(out.tasks[0].comparison.baseline).toEqual({ kind: "period", period: expect.objectContaining({ value: "mês passado" }) });
  });

  it("média histórica com baseline_period preenchido à toa continua sendo média por N meses", () => {
    const out = normalizeSemanticInterpreterV3Output(turn({
      direction: "any", baseline_kind: "mean_previous_complete_months", baseline_period: period("x"), baseline_months: 3, target: null,
    })) as any;
    expect(out.tasks[0].comparison.baseline).toEqual({ kind: "mean_previous_complete_months", months: 3 });
  });

  it("recusa diz qual campo falhou, sem texto da pessoa", () => {
    const bad = normalizeSemanticInterpreterV3Output(turn({
      direction: "any", baseline_kind: "mean_previous_complete_months", baseline_period: null, baseline_months: null, target: null,
    }));
    expect(bad).toBeNull();
    expect(lastNormalizeFailure()).toBe("comparison.baseline_months_required_for_mean");
    const ok = normalizeSemanticInterpreterV3Output(turn(null, { operation: "breakdown" }));
    expect(ok).not.toBeNull();
    expect(lastNormalizeFailure()).toBeNull();
  });

  it("nova tentativa leva o motivo; outros erros não geram dica", () => {
    expect(contractRepairHint("semantic_tiers_unavailable:semantic_interpreter_v3_contract_invalid:comparison.baseline_months_required_for_mean"))
      .toContain("comparison.baseline_months_required_for_mean");
    expect(contractRepairHint("structured_call_gateway_400")).toBeNull();
    expect(contractRepairHint(null)).toBeNull();
  });
});
