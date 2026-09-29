import { describe, expect, it } from "vitest";
import { resolvePeriodExpressions } from "../../supabase/functions/_shared/analytics/multiPeriodResolver";

const NOW = new Date("2026-09-28T15:00:00-03:00");

describe("Nino temporal authority precedence", () => {
  it("canonical V3 window wins when legacy provenance text is also present", () => {
    const resolved = resolvePeriodExpressions(
      ["2026-09-21..2026-09-27", "este mês"],
      "quanto eu gastei este mês?",
      NOW,
    );
    expect(resolved.source).toBe("single");
    expect(resolved.matched).toEqual(["2026-09-21..2026-09-27"]);
    expect(resolved.periods).toHaveLength(1);
    expect(resolved.periods[0]).toMatchObject({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("never falls back to raw text when an authoritative expression cannot be resolved", () => {
    const resolved = resolvePeriodExpressions(
      ["quando eu era criança"],
      "este mês",
      NOW,
    );
    expect(resolved.source).toBe("unresolved_authoritative");
    expect(resolved.periods).toEqual([]);
  });
});
