import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { evaluateProgressPure } from "../../supabase/functions/_shared/agent/changeLoop.ts";
import { principlesForStage } from "../../supabase/functions/_shared/agent/behavioralPrinciples.ts";

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

describe("nino_change_agent.v1 — loop de mudança", () => {
  it("caixa negativo melhora por evidência e conclui quando volta a >= 0", () => {
    const result = evaluateProgressPure({
      stage: "stabilize_cash",
      baseline: { projected_month_end_available: -500 },
      current: { projected_month_end_available: 100 },
      target_amount: 500,
    });
    expect(result.outcome).toBe("completed");
    expect(result.score).toBe(1);
  });

  it("meta mede aporte real, não intenção", () => {
    const noAction = evaluateProgressPure({
      stage: "fund_goal",
      baseline: {},
      current: {},
      target_amount: 400,
      goal_contributions: 0,
    });
    const acted = evaluateProgressPure({
      stage: "fund_goal",
      baseline: {},
      current: {},
      target_amount: 400,
      goal_contributions: 400,
    });
    expect(noAction.outcome).toBe("stalled");
    expect(acted.outcome).toBe("completed");
  });

  it("patrimônio mede aplicação confirmada", () => {
    expect(evaluateProgressPure({
      stage: "build_wealth",
      baseline: {},
      current: {},
      target_amount: 300,
      investment_applications: 150,
    }).outcome).toBe("progress");
  });

  it("truth gate impede fingir progresso", () => {
    expect(evaluateProgressPure({
      stage: "build_wealth",
      baseline: {},
      current: {},
      target_amount: 300,
      investment_applications: 300,
      truth_blocked: true,
    }).outcome).toBe("no_evidence");
  });

  it("princípios moldam intervenção mas não criam percentual universal", () => {
    expect(principlesForStage("build_wealth")).toContain("pay_yourself_first");
    const source = read("supabase/functions/_shared/agent/behavioralPrinciples.ts");
    expect(source).toContain("Nunca calculam dinheiro");
    expect(source).toContain("Inventar um percentual universal");
  });
});

describe("nino_change_agent.v1 — contratos de integração", () => {
  it("próximo passo persiste recomendação e tem compromisso separado", () => {
    const tools = read("supabase/functions/_shared/agent/tools.ts");
    expect(tools).toContain("persistNextActionRecommendation");
    expect(tools).toContain('name: "commit_latest_change_action"');
    expect(tools).toContain('name: "get_change_commitment_status"');
  });

  it("follow-up entra no mesmo governador proativo", () => {
    const pipeline = read("supabase/functions/_shared/proactive/pipeline.ts");
    expect(pipeline).toContain("buildDueChangeFollowups");
    expect(pipeline).toContain("situations.push(...dueFollowups)");
    expect(pipeline).toContain("allocateAttention");
    expect(pipeline).toContain("markSelectedChangeFollowups");
  });

  it("LearningLoop grava ledger auditável", () => {
    const learning = read("supabase/functions/_shared/agent/core/LearningLoop.ts");
    expect(learning).toContain("recordLearningEvent");
    expect(learning).toContain('event_type: "correction"');
  });
});

describe("Admin hardening", () => {
  it("remove teto 5/dia e 14/semana do frontend", () => {
    const rules = read("src/components/admin/messaging/RulesBoard.tsx");
    expect(rules).not.toContain('max={5}');
    expect(rules).not.toContain('max={14}');
    expect(rules).toContain("sem teto fixo");
  });

  it("migration remove clamps antigos do backend", () => {
    const dir = `${process.cwd()}/supabase/migrations`;
    const file = readdirSync(dir)
      .filter((f) => readFileSync(`${dir}/${f}`, "utf8").includes("nino_change_commitments"))
      .sort()
      .pop();
    expect(file).toBeTruthy();
    const migration = readFileSync(`${dir}/${file}`, "utf8");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS proactive_global_limits_day_range");
    expect(migration).not.toContain("least(5");
    expect(migration).not.toContain("least(14");
  });

  it("Admin usa telemetria v3 e possui aba Aprendizado", () => {
    const ai = read("src/components/admin/AiEfficiencyHistoryBoard.tsx");
    const page = read("src/pages/admin/IAInteligencia.tsx");
    expect(ai).toContain('admin_v3_ai_history');
    expect(page).toContain('value="learning"');
    expect(page).toContain("NinoLearningBoard");
  });
});
