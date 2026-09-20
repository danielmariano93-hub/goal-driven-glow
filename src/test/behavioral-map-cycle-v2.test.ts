import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mapCycle = readFileSync("src/lib/behavioral/mapCycle.ts", "utf8");
const dashboard = readFileSync("src/lib/behavioral/dashboardSnapshot.ts", "utf8");
const observedV2 = readFileSync("src/lib/behavioral/observedProfileV2.ts", "utf8");
const wheel = readFileSync("src/components/behavioral/BehaviorWheel.tsx", "utf8");
const page = readFileSync("src/pages/Emocoes.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260920124200_behavioral_map_cycle_v2.sql", "utf8");

describe("behavioral map cycle v2", () => {
  it("reuses legacy emotional check-ins instead of resetting history", () => {
    expect(dashboard).toContain("payload.checkins ?? []");
    expect(dashboard).toContain("emotionalScore(row)");
    expect(dashboard).toContain("moodHistory");
    expect(page).toContain("<MoneyMoodTimeline snapshot={dashboard}");
    expect(page).toContain("const checkins30 = dashboard.checkins.filter");
  });

  it("keeps self-perception separate from Nino observed evidence", () => {
    expect(dashboard).toContain("ObservedBehaviorProfile");
    expect(dashboard).toContain("buildObservedProfileV2");
    expect(observedV2).toContain("coverage: scored.length");
    expect(observedV2).toContain("confidenceWeight(row.confidence)");
    expect(wheel).toContain("Sua nota");
    expect(wheel).toContain("Nino observa");
    expect(wheel).toContain('dataKey="self"');
    expect(wheel).toContain('dataKey="nino"');
  });

  it("makes the map a 30-day recurring measurement with rotating questions", () => {
    expect(mapCycle).toContain("BEHAVIOR_MAP_CADENCE_DAYS = 30");
    expect(mapCycle).toContain("wheel_set_a");
    expect(mapCycle).toContain("wheel_set_b");
    expect(mapCycle).toContain("wheel_set_c");
    expect(wheel).toContain("behaviorQuestionForDimension");
    expect(wheel).toContain("perguntas rotativas");
    expect(migration).toContain("next_due_at");
    expect(migration).toContain("interval '30 days'");
  });

  it("persists the observed snapshot and schedules a future proactive review", () => {
    expect(migration).toContain("observed_scores jsonb");
    expect(migration).toContain("observed_overall_score");
    expect(migration).toContain("behavioral_assessment_save_v2");
    expect(migration).toContain("behavioral_reassessment_due");
    expect(migration).toContain("pending_proactive_suggestions");
    expect(migration).toContain("next_attempt_at");
    expect(mapCycle).toContain('rpc as any)("behavioral_assessment_save_v2"');
  });

  it("does not pretend every behavioral dimension has enough evidence", () => {
    expect(observedV2).toContain("Ainda não há evidência suficiente");
    expect(observedV2).toContain("score: null");
    expect(observedV2).toContain("insufficient_data");
  });
});
