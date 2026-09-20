import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/Emocoes.tsx", "utf8");
const resilient = readFileSync("src/lib/behavioral/resilientClient.ts", "utf8");

describe("emotional tab resilience", () => {
  it("does not let one auxiliary data failure blank the whole emotional tab", () => {
    expect(page).toContain("loadBehavioralEvolutionResilient");
    expect(resilient).toContain("loadBehavioralEvolution(userId)");
    expect(resilient).toContain("loadBehavioralEvolutionFallback(userId)");
    expect(resilient).toContain("safeRows<EmotionalCheckinRow>");
    expect(resilient).toContain("safeRows<BehaviorExperimentTemplate>");
    expect(resilient).toContain("degradedSources");
  });

  it("keeps the new behavioral features visible in degraded mode", () => {
    expect(page).toContain("Sua evolução está disponível em modo seguro.");
    expect(page).toContain("<BehaviorWheel");
    expect(page).toContain("<ExperimentsBoard");
    expect(page).toContain("<MoneyMoodTimeline");
    expect(page).toContain("<CoachHighlights");
  });

  it("does not fabricate spend-emotion correlation when the primary loader failed", () => {
    expect(resilient).toContain("sufficient: false");
    expect(resilient).toContain("vulnerableAverage: null");
    expect(resilient).toContain("comparisonAverage: null");
    expect(resilient).toContain("upliftPct: null");
  });
});
