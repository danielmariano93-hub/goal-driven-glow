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
    expect(pipeline).toContain("reconcileChangeFollowupDeliveries");
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
      .filter((f) => readFileSync(`${dir}/${f}`, "utf8").includes("CREATE TABLE IF NOT EXISTS public.nino_change_commitments"))
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

describe("nino_change_agent.v1 — hardening auditado", () => {
  it("revalidação material invalida mudança relevante e ignora centavo", async () => {
    const { hasMaterialRecommendationChange } = await import(
      "../../supabase/functions/_shared/agent/changeLoop.ts"
    );
    const base = { stage: "fund_goal", goal_id: "g1", route: "/app/metas", amount: 800, amount_role: "monthly_contribution" };
    expect(hasMaterialRecommendationChange(base, { ...base, amount: 803 }).changed).toBe(false);
    const material = hasMaterialRecommendationChange(base, { ...base, amount: 300 });
    expect(material.changed).toBe(true);
    expect(material.reasons).toContain("amount_changed_materially");
    expect(hasMaterialRecommendationChange(base, { ...base, stage: "stabilize_cash" }).reasons)
      .toContain("stage_changed");
    expect(hasMaterialRecommendationChange(base, { ...base, truth_blocked: true }).reasons)
      .toContain("truth_gate_blocked");
  });

  it("estratégia alterna para reframe depois de sem avanço repetido e pausa após descartes", async () => {
    const { resolveChangeStrategy } = await import(
      "../../supabase/functions/_shared/agent/changeLoop.ts"
    );
    expect(resolveChangeStrategy({ outcome: "progress", stage: "fund_goal", consecutive_stalls: 0, dismissals: 0, intervention_attempts: 1 }).strategy)
      .toBe("reinforce");
    expect(resolveChangeStrategy({ outcome: "stalled", stage: "fund_goal", consecutive_stalls: 2, dismissals: 0, intervention_attempts: 2 }).strategy)
      .toBe("reframe");
    expect(resolveChangeStrategy({ outcome: "regressed", stage: "fund_goal", consecutive_stalls: 1, dismissals: 0, intervention_attempts: 2 }).strategy)
      .toBe("reframe");
    expect(resolveChangeStrategy({ outcome: "stalled", stage: "fund_goal", consecutive_stalls: 4, dismissals: 1, intervention_attempts: 6 }).strategy)
      .toBe("pause");
    expect(resolveChangeStrategy({ outcome: "stalled", stage: "fund_goal", consecutive_stalls: 1, dismissals: 4, intervention_attempts: 2 }).strategy)
      .toBe("pause");
  });

  it("princípio molda intervenção, proíbe culpa e nunca cria número", async () => {
    const { resolveBehavioralIntervention } = await import(
      "../../supabase/functions/_shared/agent/behavioralPrinciples.ts"
    );
    const stabilize = resolveBehavioralIntervention({ stage: "stabilize_cash", outcome: "stalled" });
    expect(stabilize.strategy).toBe("remind");
    expect(stabilize.prohibited_patterns.join(" ")).toMatch(/culpa/);
    expect(stabilize.prohibited_patterns.join(" ")).toMatch(/aporte|investimento/);
    expect(stabilize.context_for_llm).not.toMatch(/\d+%/);

    const reframe = resolveBehavioralIntervention({ stage: "fund_goal", outcome: "regressed" });
    expect(reframe.strategy).toBe("reframe");
    expect(reframe.prohibited_patterns.join(" ")).toMatch(/repetir o mesmo pedido/);
  });

  it("perfil de aprendizado influencia a escolha do princípio", async () => {
    const { resolveBehavioralIntervention } = await import(
      "../../supabase/functions/_shared/agent/behavioralPrinciples.ts"
    );
    const principles = ["margin_of_safety", "friction_and_nudge"] as const;
    const chosen = resolveBehavioralIntervention({
      stage: "stabilize_cash",
      outcome: "stalled",
      principles: [...principles] as any,
      learningProfile: {
        principle_success: {
          margin_of_safety: { total: 4, success: 0 },
          friction_and_nudge: { total: 4, success: 4 },
        },
      },
    });
    expect(chosen.principle).toBe("friction_and_nudge");
  });

  it("check-in só nasce de entrega confirmada, nunca do ranking", () => {
    const pipeline = read("supabase/functions/_shared/proactive/pipeline.ts");
    expect(pipeline).not.toContain("markSelectedChangeFollowups(");
    expect(pipeline).toContain("reconcileChangeFollowupDeliveries");
    const dispatcher = read("supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts");
    expect(dispatcher).toContain("confirmChangeFollowupDelivery");
    const loop = read("supabase/functions/_shared/agent/changeLoop.ts");
    expect(loop).toContain('source: "delivery_confirmed"');
    expect(loop).toContain("communicated: true");
  });

  it("migration protege compromisso único ativo, domínios e backfill", () => {
    const dir = `${process.cwd()}/supabase/migrations`;
    const file = readdirSync(dir)
      .filter((f) => readFileSync(`${dir}/${f}`, "utf8").includes("nino_change_commitments_one_active_idx"))
      .sort()
      .pop();
    expect(file).toBeTruthy();
    const sql = readFileSync(`${dir}/${file}`, "utf8");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS nino_change_commitments_one_active_idx");
    expect(sql).toContain("WHERE status = 'active'");
    expect(sql).toContain("nino_change_checkins_outcome_chk");
    expect(sql).toContain("nino_change_commitments_strategy_chk");
    expect(sql).toContain("agent_memory_backfill");
    expect(sql).toContain("generate_series(v_from, v_to");
    expect(sql).toContain("p_workload");
    expect(sql).not.toMatch(/DELETE FROM public\.transactions/);
  });

  it("Admin filtra workload e mostra origem de cada número", () => {
    const board = read("src/components/admin/AiEfficiencyHistoryBoard.tsx");
    expect(board).toContain("p_workload");
    expect(board).toContain("AGENT_CONVERSATION");
    const learning = read("src/components/admin/NinoLearningBoard.tsx");
    expect(learning).toContain("current_strategy");
    expect(learning).toContain("delivered_checkins");
  });
});
