import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  selectBehaviorWealthStage,
} from "../../supabase/functions/_shared/behavior-wealth/nextBestAction.ts";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

describe("nino_behavior_wealth.v1 — estágio financeiro", () => {
  const base = {
    truth_blocked: false,
    available_today: 5000,
    projected_month_end_available: 2000,
    monthly_income: 10000,
    monthly_debt_installments: 0,
    has_active_goal: false,
    sustainable_monthly_saving: 800,
  };

  it("bloqueia patrimônio quando a verdade financeira está insegura", () => {
    expect(selectBehaviorWealthStage({ ...base, truth_blocked: true }).stage)
      .toBe("repair_truth");
  });

  it("caixa negativo vem antes de patrimônio", () => {
    expect(selectBehaviorWealthStage({
      ...base,
      projected_month_end_available: -300,
    }).stage).toBe("stabilize_cash");
  });

  it("dívida só ganha prioridade quando consome a própria folga projetada", () => {
    expect(selectBehaviorWealthStage({
      ...base,
      monthly_debt_installments: 2500,
      projected_month_end_available: 2000,
    }).stage).toBe("reduce_debt_pressure");

    expect(selectBehaviorWealthStage({
      ...base,
      monthly_debt_installments: 500,
      projected_month_end_available: 2000,
      has_active_goal: true,
    }).stage).toBe("fund_goal");
  });

  it("meta ativa precede patrimônio genérico quando a base está estável", () => {
    expect(selectBehaviorWealthStage({
      ...base,
      has_active_goal: true,
    }).stage).toBe("fund_goal");
  });

  it("capacidade sustentável sem meta vira construção patrimonial", () => {
    expect(selectBehaviorWealthStage(base).stage).toBe("build_wealth");
  });
});

describe("nino_behavior_wealth.v1 — contratos de segurança", () => {
  it("hipótese pending não é mais colocada na fila proativa", () => {
    const source = read("supabase/functions/_shared/agent/core/BehaviorService.ts");
    expect(source).not.toContain('candidate.confidence >= 0.72 && effectiveStatus === "pending"');
    expect(source).toContain("behavior_hypothesis_not_confirmed");
  });

  it("o ranking persistido é o ranking calculado, não o array com score zero", () => {
    const ranking = read("supabase/functions/_shared/proactive/ranking.ts");
    const pipeline = read("supabase/functions/_shared/proactive/pipeline.ts");
    expect(ranking).toContain("selected: [...selected.values()], ranked");
    expect(pipeline).toContain("signals, ranked, decisions, selected");
    expect(pipeline).toContain("top: ranked.slice(0, 5)");
  });

  it("a capability de próximo passo é determinística e usa tool própria", () => {
    const router = read("supabase/functions/_shared/agent/core/CapabilityRouter.ts");
    const tools = read("supabase/functions/_shared/agent/tools.ts");
    expect(router).toContain('name: "next_best_action", execution: "deterministic"');
    expect(router).toContain('required_tool: "get_next_best_action"');
    expect(tools).toContain('name: "get_next_best_action"');
    expect(tools).toContain("computeNextBestAction");
  });

  it("a identidade deixa organizador como infraestrutura, não proposta de valor", () => {
    const conversational = read("supabase/functions/_shared/agent/core/Conversational.ts");
    expect(conversational).toContain("mudança de comportamento e construção de patrimônio");
    expect(conversational).toContain("cada decisão de hoje precisa deixar sua vida financeira mais forte amanhã");
  });
});
