import { describe, expect, it } from "vitest";
import { experimentOutcome } from "@/lib/behavioral/experimentOutcome";
import type { BehaviorExperiment } from "@/lib/behavioral/client";

function exp(overrides: Partial<BehaviorExperiment> = {}): BehaviorExperiment {
  return {
    id: "e1",
    template_slug: "pause-before-spend",
    title: "Pausa antes de gastar",
    dimension: "control",
    tracking_kind: "spend_reduction_pct",
    status: "completed",
    target_value: 15,
    current_value: 20,
    progress: 100,
    baseline_value: 100,
    result_value: 20,
    result_delta_pct: 20,
    started_at: "2026-09-01T12:00:00Z",
    ends_at: "2026-09-08T12:00:00Z",
    completed_at: "2026-09-08T12:00:00Z",
    ...overrides,
  };
}

describe("experimentOutcome", () => {
  it("converte redução percentual em antes/depois e efeito estimado em reais", () => {
    expect(experimentOutcome(exp())).toMatchObject({
      baseline: 100,
      current: 80,
      deltaPct: 20,
      savedPerDay: 20,
      savedTotal: 140,
      durationDays: 7,
      recommendation: "continue",
    });
  });

  it("recomenda trocar quando experimento expira sem atingir resultado", () => {
    expect(experimentOutcome(exp({ status: "expired", progress: 35, current_value: 4, result_value: null, result_delta_pct: null })).recommendation).toBe("switch");
  });

  it("não inventa efeito em reais para experimento não financeiro", () => {
    const outcome = experimentOutcome(exp({
      tracking_kind: "checkin_count",
      baseline_value: 2,
      current_value: 8,
      result_value: 8,
      result_delta_pct: 300,
    }));
    expect(outcome.savedTotal).toBeNull();
    expect(outcome.current).toBe(8);
  });
});
