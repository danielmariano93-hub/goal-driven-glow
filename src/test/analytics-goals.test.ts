import { describe, it, expect } from "vitest";
import { projectGoal, simulatePace } from "../../supabase/functions/_shared/analytics/goals";

describe("projectGoal", () => {
  const goal = { id: "g1", name: "Reserva", target_amount: 6000, target_date: "2026-12-31" as string | null, status: "active" };

  it("insufficient_data quando <3 aportes", () => {
    const r = projectGoal({ goal, contributions: [{ amount: 500, occurred_at: "2026-07-01" }], today: "2026-07-15" });
    expect(r.provenance.confidence).toBe("insufficient_data");
  });

  it("ritmo observado ~ média dos últimos 90d / 3", () => {
    const contribs = [
      { amount: 300, occurred_at: "2026-05-01" },
      { amount: 300, occurred_at: "2026-06-01" },
      { amount: 300, occurred_at: "2026-07-01" },
    ];
    const r = projectGoal({ goal, contributions: contribs, today: "2026-07-15" });
    expect(r.observed_pace_month).toBeCloseTo(300, 0);
    expect(r.projected_date).not.toBeNull();
  });

  it("simulatePace projeta com aporte hipotético", () => {
    const s = simulatePace({ goal, contributions: [], today: "2026-07-15" }, 1000);
    expect(s.months).toBeGreaterThan(0);
    expect(s.projected_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
