import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/Emocoes.tsx", "utf8");
const dashboard = readFileSync("src/lib/behavioral/dashboardSnapshot.ts", "utf8");
const experiments = readFileSync("src/components/behavioral/ExperimentsBoard.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260920132852_behavioral_dashboard_snapshot_rpc.sql", "utf8");

describe("behavioral dashboard runtime", () => {
  it("loads the primary behavioral UI from one authenticated snapshot", () => {
    expect(migration).toContain("create or replace function public.behavioral_dashboard_snapshot()");
    expect(migration).toContain("v_uid uuid := auth.uid()");
    expect(migration).toContain("revoke all on function public.behavioral_dashboard_snapshot() from public");
    expect(migration).toContain("grant execute on function public.behavioral_dashboard_snapshot() to authenticated");
    expect(dashboard).toContain('(supabase.rpc as any)("behavioral_dashboard_snapshot")');
    expect(page).toContain('["behavioral-dashboard", user?.id]');
  });

  it("keeps historical check-ins, assessments and active experiments in the canonical read model", () => {
    expect(migration).toContain("'checkins'");
    expect(migration).toContain("'assessments'");
    expect(migration).toContain("'experiments'");
    expect(migration).toContain("'financial_snapshot'");
    expect(migration).toContain("'transaction_stats'");
    expect(dashboard).toContain("moodHistory");
    expect(dashboard).toContain("activeExperiments");
    expect(dashboard).toContain("buildObserved");
  });

  it("surfaces active experiments before the emotional check-in", () => {
    const experimentIndex = page.indexOf('dashboard.activeExperiments.length > 0');
    const checkinIndex = page.indexOf("<EmotionalCheckinCard />");
    expect(experimentIndex).toBeGreaterThan(-1);
    expect(checkinIndex).toBeGreaterThan(experimentIndex);
  });

  it("shows a real experiment timeline and habit progress", () => {
    expect(experiments).toContain("Dia {timing.elapsedDays} de {timing.durationDays}");
    expect(experiments).toContain("dias restantes");
    expect(experiments).toContain("Tempo do experimento");
    expect(experiments).toContain("Progresso do hábito");
    expect(experiments).toContain("formatDate(experiment.started_at)");
    expect(experiments).toContain("formatDate(experiment.ends_at)");
    expect(experiments).toContain("timeProgress");
  });
});
