import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260920033000_behavioral_evolution_three_waves.sql", "utf8");
const hardening = readFileSync("supabase/migrations/20260920033100_behavioral_evolution_runtime_hardening.sql", "utf8");
const integrity = readFileSync("supabase/migrations/20260920033200_behavioral_evolution_write_integrity.sql", "utf8");
const page = readFileSync("src/pages/Emocoes.tsx", "utf8");
const checkin = readFileSync("src/components/home/EmotionalCheckinCard.tsx", "utf8");
const client = readFileSync("src/lib/behavioral/client.ts", "utf8");
const wheel = readFileSync("src/components/behavioral/BehaviorWheel.tsx", "utf8");
const mood = readFileSync("src/components/behavioral/MoneyMoodTimeline.tsx", "utf8");
const experiments = readFileSync("src/components/behavioral/ExperimentsBoard.tsx", "utf8");
const highlights = readFileSync("src/components/behavioral/CoachHighlights.tsx", "utf8");

describe("behavioral evolution — three waves", () => {
  it("wave 1 quantifies money mood without claiming a clinical score", () => {
    for (const field of ["financial_calm_score", "financial_control_score", "spending_urge_score", "context_key"]) {
      expect(migration).toContain(field);
      expect(checkin).toContain(field);
    }
    expect(migration).toContain("behavioral_assessments");
    expect(migration).toContain("behavioral_assessment_save");
    expect(wheel).toContain("Roda financeira comportamental");
    expect(wheel).toContain("não como diagnóstico");
    expect(mood).toContain("Tranquilidade financeira declarada por você");
  });

  it("wave 2 turns weak dimensions into measurable experiments", () => {
    expect(migration).toContain("behavior_experiment_templates");
    expect(migration).toContain("behavior_experiments");
    expect(migration).toContain("behavior_experiment_events");
    expect(migration).toContain("behavior_experiment_start");
    expect(hardening).toContain("behavior_experiment_refresh");
    for (const kind of ["checkin_count", "no_spend_days", "spend_reduction_pct", "manual"]) {
      expect(migration).toContain(kind);
    }
    expect(client).toContain("recommendedForDimension");
    expect(experiments).toContain('experiment.tracking_kind === "manual"');
    expect(experiments).toContain("Você não precisa marcar tarefa manualmente");
    expect(page).toContain('id="experimentos"');
  });

  it("wave 3 creates actionable highlights with evidence and minimum samples", () => {
    expect(client).toContain("vulnerable.length >= 3");
    expect(client).toContain("comparison.length >= 3");
    expect(client).toContain("paired.length >= 8");
    expect(client).toContain("não uma relação de causa");
    expect(highlights).toContain("Correlação emocional nunca é apresentada como diagnóstico ou causa");
    expect(page).toContain("padrões são hipóteses com amostra mínima");
    expect(page).toContain("não trata correlação como causa");
  });

  it("only explicit user signals or completed experiments queue behavioral proactivity", () => {
    expect(hardening).toContain("queue_declared_money_mood_highlight");
    expect(hardening).toContain("financial_calm_score > 4");
    expect(hardening).toContain("spending_urge_score < 8");
    expect(hardening).toContain("declared_money_mood");
    expect(hardening).toContain("queue_behavior_experiment_completion");
    expect(hardening).toContain("new.status <> 'completed'");
    expect(hardening).toContain("'emotional_spending'");
    expect(hardening).toContain("'financial_discipline'");
    expect(hardening).not.toContain("behavior_coach_highlight','");
  });

  it("keeps assessment and experiment writes behind validated RPCs", () => {
    expect(integrity).toContain("drop policy if exists behavioral_assessments_insert_own");
    expect(integrity).toContain("drop policy if exists behavior_experiments_insert_own");
    expect(integrity).toContain("drop policy if exists behavior_experiments_update_own");
    expect(integrity).toContain("drop policy if exists behavior_experiment_events_insert_own");
    expect(integrity).toContain("revoke execute on function public.behavior_experiment_start(text) from public, anon");
    expect(integrity).toContain("grant execute on function public.behavior_experiment_refresh(uuid) to authenticated, service_role");
  });

  it("uses the existing Nino design language rather than the benchmark's literal styling", () => {
    expect(page).toContain("shadow-card");
    expect(wheel).toContain("hsl(var(--primary))");
    expect(mood).toContain("hsl(var(--primary))");
    expect(mood).toContain('type="monotoneX"');
    expect(page).not.toContain("Mental Fitness");
  });
});
