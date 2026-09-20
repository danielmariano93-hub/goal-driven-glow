import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/Emocoes.tsx", "utf8");
const dashboard = readFileSync("src/lib/behavioral/dashboardSnapshot.ts", "utf8");
const resilient = readFileSync("src/lib/behavioral/resilientClient.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260920132852_behavioral_dashboard_snapshot_rpc.sql", "utf8");

describe("emotional tab resilience", () => {
  it("uses one canonical authenticated snapshot before falling back to legacy reads", () => {
    expect(page).toContain("loadBehavioralDashboardSnapshot");
    expect(page).toContain("loadBehavioralEvolutionResilient");
    expect(page).toContain("loadDashboardWithFallback");
    expect(dashboard).toContain('(supabase.rpc as any)("behavioral_dashboard_snapshot")');
    expect(migration).toContain("auth.uid()");
  });

  it("keeps the behavioral features visible when an auxiliary source degrades", () => {
    expect(page).toContain("Uma parte da análise está em modo seguro.");
    expect(page).toContain("<BehaviorWheel");
    expect(page).toContain("<ExperimentsBoard");
    expect(page).toContain("<MoneyMoodTimeline");
    expect(page).toContain("<CoachHighlights");
  });

  it("does not zero real records merely because an auxiliary source failed", () => {
    expect(page).toContain("return await loadBehavioralDashboardSnapshot()");
    expect(page).toContain("const fallback = await loadBehavioralEvolutionResilient(userId)");
    expect(resilient).toContain("safeRows<EmotionalCheckinRow>");
    expect(resilient).toContain("safeRows<BehaviorExperimentTemplate>");
    expect(dashboard).toContain("payload.checkins ?? []");
    expect(dashboard).toContain("payload.experiments ?? []");
  });

  it("keeps the experiment catalog inside the canonical read model", () => {
    expect(migration).toContain("'templates'");
    expect(migration).toContain("behavior_experiment_templates");
    expect(dashboard).toContain("recommendedTemplates: recommendedForDimension");
  });

  it("does not fabricate spend-emotion correlation when the fallback loader lacks evidence", () => {
    expect(resilient).toContain("sufficient: false");
    expect(resilient).toContain("vulnerableAverage: null");
    expect(resilient).toContain("comparisonAverage: null");
    expect(resilient).toContain("upliftPct: null");
  });
});
