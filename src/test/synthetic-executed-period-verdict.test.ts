import { describe, expect, it } from "vitest";
// @ts-ignore - shared evaluation module is JavaScript ES module
import { expectedComparisonWindows, gradeExecutedComparison } from "../../supabase/functions/_shared/synthetic/periodTruth.mjs";
// @ts-ignore - shared evaluation module is JavaScript ES module
import { scoreScenario } from "../../supabase/functions/_shared/synthetic/score.mjs";

const ref = "2026-11-24";
const current = { from: "2026-11-01", to: "2026-11-24" };
const same = { from: "2026-10-01", to: "2026-10-24" };
const full = { from: "2026-10-01", to: "2026-10-31" };
const call = (period_a: any, period_b: any) => ({
  tool_name: "compare_periods", ok: true, args: { period_a, period_b },
});

describe("independent execution-window evaluation", () => {
  it("generates precise expected windows from fixed reference time", () => {
    expect(expectedComparisonWindows(ref)).toEqual({ current, baseline: same });
    expect(expectedComparisonWindows(ref, "previous_full_month")).toEqual({ current, baseline: full });
  });
  it("accepts either argument order when both temporal scopes are exact", () => {
    expect(gradeExecutedComparison({ today: ref, tool_calls: [call(current, same)] }).verdict).toBe("CORRECT");
    expect(gradeExecutedComparison({ today: ref, tool_calls: [call(same, current)] }).verdict).toBe("CORRECT");
  });
  it("rejects comparison with previous whole month even if currency values match", () => {
    expect(gradeExecutedComparison({ today: ref, tool_calls: [call(full, current)] }).verdict).toBe("WRONG");
  });
  it("distinguishes deliberate comparison with previous full month", () => {
    expect(gradeExecutedComparison({ today: ref, mode: "previous_full_month", tool_calls: [call(current, full)] }).verdict).toBe("CORRECT");
    expect(gradeExecutedComparison({ today: ref, mode: "previous_full_month", tool_calls: [call(current, same)] }).verdict).toBe("WRONG");
  });
  it("does not mark unobserved execution correct", () => {
    expect(gradeExecutedComparison({ today: ref, tool_calls: [] }).verdict).toBe("UNVERIFIED");
  });
  it("accounts for February and year transitions deterministically", () => {
    expect(expectedComparisonWindows("2026-03-31")?.baseline).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(expectedComparisonWindows("2026-01-15")?.baseline).toEqual({ from: "2025-12-01", to: "2025-12-15" });
  });
  it("vetoes false positives in the existing numeric scorer", () => {
    const opts = {
      expect: { numbers: ["mtd:exp", "same:exp"], comparison_window: "same_days" },
      replies: ["Em novembro: R$ 2.000,00 e em outubro: R$ 1.500,00"],
      state: { txs: [] }, truth: { "mtd:exp": 2000, "same:exp": 1500 },
      level: 2, today: ref,
    };
    const wrong = scoreScenario({ ...opts, tool_calls: [call(current, full)] });
    expect(wrong.verdict).toBe("WRONG");
    expect(wrong.layers.periodo).toBe("WRONG");
    const correct = scoreScenario({ ...opts, tool_calls: [call(current, same)] });
    expect(correct.verdict).toBe("CORRECT");
    expect(correct.layers.periodo).toBe("CORRECT");
    const missing = scoreScenario({ ...opts, tool_calls: [] });
    expect(missing.verdict).toBe("UNVERIFIED");
  });
});
