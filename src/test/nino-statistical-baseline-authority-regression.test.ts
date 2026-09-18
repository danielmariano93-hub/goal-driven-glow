import { describe, expect, it } from "vitest";
import type { CanonicalConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";
import { normalizeToV3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import { applyTurnAspect } from "../../supabase/functions/_shared/agent/core/SemanticAspectOverlay";
import { executedIRFrom } from "../../supabase/functions/_shared/agent/core/ExecutedIRBridge";
import { requestedSubsumesExecuted } from "../../supabase/functions/_shared/agent/core/SemanticPreservation";

const AUGUST = { from: "2026-08-01", to: "2026-08-31", label: "agosto" };
const JULY = { from: "2026-07-01", to: "2026-07-31", label: "julho" };

function turn(): CanonicalConversationTurnContract {
  return {
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "read",
    domain: "financial_read",
    canonical_request: "Quais categorias ficaram acima da média dos últimos 3 meses?",
    inherit_focus: true,
    focus: {
      category: null,
      merchant: null,
      goal: null,
      period_expression: "agosto",
      period_expressions: ["agosto"],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "resolved",
      entity: "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "analyze",
      queries: [{
        metric: "expense_amount",
        operation: "compare",
        group_by: ["category"],
        filters: [],
        limit: null,
        comparison_direction: "increase",
        comparison_baseline: "mean_previous_complete_months",
        comparison_baseline_window: 3,
        comparison_baseline_expression: null,
        comparison_target_expression: "agosto",
      }],
    },
    advisory_kind: null,
  };
}

describe("regressão 18/09 — baseline estatístico mantém autoridade temporal", () => {
  it("não deixa 'últimos 3 meses' reescrever o target agosto como last_n_complete", () => {
    const compiled = compileFinancialReadFromTurn({
      turn: turn(),
      period: AUGUST,
      comparison_period: JULY,
    });
    expect(compiled?.ir).toBeTruthy();

    const v3 = normalizeToV3(compiled!.ir!, { today: "2026-09-18" });
    const before = v3.queries[0];
    expect(before.time).toMatchObject({
      aspect: "calendar",
      from: AUGUST.from,
      to: AUGUST.to,
    });
    expect(before.comparison_baseline).toBe("mean_previous_complete_months");
    expect(before.comparison_baseline_window).toBe(3);

    const overlay = applyTurnAspect(
      v3,
      "Quais categorias ficaram acima da média dos últimos 3 meses?",
      new Date("2026-09-18T12:00:00Z"),
    );

    expect(overlay.applied).toBe(false);
    expect(overlay.changed_queries).toEqual([]);
    expect(overlay.ir.queries[0].time).toMatchObject({
      aspect: "calendar",
      from: AUGUST.from,
      to: AUGUST.to,
    });
    expect(overlay.ir.queries[0].grain).toBe("none");
  });

  it("o resultado do motor de média passa pelo preservation gate sem falso positivo", () => {
    const compiled = compileFinancialReadFromTurn({
      turn: turn(),
      period: AUGUST,
      comparison_period: JULY,
    });
    const v3 = normalizeToV3(compiled!.ir!, { today: "2026-09-18" });
    const requested = applyTurnAspect(
      v3,
      "Quais categorias ficaram acima da média dos últimos 3 meses?",
      new Date("2026-09-18T12:00:00Z"),
    ).ir.queries[0];

    const engineResult = {
      baseline_statistic: "mean",
      baseline_window_months: 3,
      baseline_periods: [
        { from: "2026-05-01", to: "2026-05-31" },
        { from: "2026-06-01", to: "2026-06-30" },
        { from: "2026-07-01", to: "2026-07-31" },
      ],
      target_period: { from: AUGUST.from, to: AUGUST.to },
      requested_group_by: "category",
      requested_comparison_direction: "increase",
      requested_comparison_baseline: "mean_previous_complete_months",
      requested_comparison_baseline_window: 3,
      total_a: 100,
      total_b: 160,
      delta_abs: 60,
      delta_pct: 0.6,
      by_group: [
        { name: "Lazer", total_a: 100, total_b: 160, delta_abs: 60, delta_pct: 0.6 },
      ],
    };

    const executed = executedIRFrom(requested, engineResult);
    const preservation = requestedSubsumesExecuted(requested, executed);

    expect(executed).toMatchObject({
      metric: "expense_amount",
      time: { aspect: "calendar", from: AUGUST.from, to: AUGUST.to },
      grain: "none",
      reduce: "sum",
      group_by: ["category"],
      comparison_baseline: "mean_previous_complete_months",
      comparison_baseline_window: 3,
    });
    expect(preservation.compatible).toBe(true);
    expect(preservation.mismatches).toEqual([]);
  });
});
