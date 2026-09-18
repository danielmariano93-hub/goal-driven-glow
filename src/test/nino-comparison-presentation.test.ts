import { describe, expect, it } from "vitest";
import {
  comparisonDeltaLabel,
  formatAverageComparisonEnhanced,
  formatPeriodComparisonEnhanced,
} from "../../supabase/functions/_shared/agent/core/ComparisonPresentation";
import { resolveGroundedComparisonFollowup } from "../../supabase/functions/_shared/agent/core/GroundedComparisonFollowup";

const evidence = {
  kind: "comparison" as const,
  rows: [
    { name: "Moradia", total_a: 121.14, total_b: 5343.47, delta_abs: 5222.33, delta_pct: 43.1099 },
    { name: "Internet", total_a: 62.59, total_b: 72.53, delta_abs: 9.94, delta_pct: 0.1588 },
    { name: "Dízimo", total_a: 0, total_b: 1569, delta_abs: 1569, delta_pct: null },
  ],
  total_a: 13126.86,
  total_b: 20607.46,
  delta_abs: 7480.6,
  delta_pct: 0.5699,
  formula_version: "compare.monthly_mean.v3",
  requested_limit: null,
  requested_direction: "increase",
  target_statistic: "monthly_mean",
  baseline_statistic: "mean",
  comparison_alignment: "preceding_rolling_window",
  target_window_months: 3,
  baseline_window_months: 3,
};

function memory(activeCategory = "Moradia") {
  return {
    active_topic_id: "topic-current",
    active_category: activeCategory,
    active_period: { from: "2026-06-18", to: "2026-09-18", label: "últimos 3 meses" },
    comparison_period: { from: "2026-03-17", to: "2026-06-17" },
    conversation_summary: "comparação dos últimos 3 meses",
    references: [{
      id: "ref-1",
      type: "entity_set",
      target: "category",
      entity_labels: ["Moradia", "Internet", "Dízimo"],
      status: "active",
      topic_id: "topic-current",
      created_at: "2026-09-18T17:45:17.644Z",
      expires_at: "2026-09-18T18:15:17.644Z",
      turns_remaining: 5,
      source: {
        tool_name: "compare_to_monthly_average",
        run_id: "run-1",
        tool_call_ids: ["call-1"],
        query_id: null,
        context: {
          months: 3,
          target_period: { from: "2026-06-18", to: "2026-09-18", label: "últimos 3 meses" },
          evidence,
        },
      },
    }],
  } as any;
}

describe("comparison presentation", () => {
  it("uses rolling-window wording and shows monetary + percentage deltas", () => {
    const text = formatAverageComparisonEnhanced({
      ...evidence,
      by_group: evidence.rows,
      requested_comparison_direction: "increase",
      target_label: "últimos 3 meses",
    });
    expect(text).toContain("janela de 3 meses imediatamente anterior");
    expect(text).not.toContain("3 meses completos anteriores");
    expect(text).toContain("R$ 5.222,33 (4.311,0%)");
    expect(text).toContain("R$ 9,94 (15,9%)");
  });

  it("does not invent a percentage when the baseline is zero", () => {
    expect(comparisonDeltaLabel(evidence.rows[2])).toContain("base anterior zerada; % não aplicável");
  });

  it("adds percentage to ordinary period comparisons too", () => {
    const text = formatPeriodComparisonEnhanced({
      total_a: 100,
      total_b: 125,
      delta_abs: 25,
      delta_pct: 0.25,
      requested_group_by: "none",
      by_group: [],
    });
    expect(text).toContain("R$ 25,00 (25,0%)");
  });
});

describe("grounded comparison follow-up", () => {
  it("interprets 'quanto menos acima' before the generic selected-entity amount path", () => {
    const contract = resolveGroundedComparisonFollowup("Ficou quanto menos acima da média?", memory("Moradia"));
    expect(contract?.direct_reply).toContain("Internet");
    expect(contract?.direct_reply).toContain("R$ 9,94 (15,9%) acima");
    expect(contract?.focus.category).toBe("Internet");
  });

  it("keeps selected-entity amount grounded and includes percentage", () => {
    const contract = resolveGroundedComparisonFollowup("Quanto acima da média ela ficou?", memory("Moradia"));
    expect(contract?.direct_reply).toContain("Moradia");
    expect(contract?.direct_reply).toContain("R$ 5.222,33 (4.311,0%) acima");
  });
});
