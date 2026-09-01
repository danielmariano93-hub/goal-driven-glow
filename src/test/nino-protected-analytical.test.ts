// Regressões `nino_analytical.v2` — incidente real de 31/08/2026:
// "Comparando essas categorias com o mesmo período do mês anterior" caiu no
// caminho legado (compare_financial_metric / get_financial_snapshot), perdeu o
// escopo para agregado global e comparou julho contra maio/junho.
import { describe, expect, it } from "vitest";
import {
  classifyProtectedAnalytical, isForbiddenSubstitute, allowedEnginesFor,
  FORBIDDEN_SUBSTITUTE_TOOLS, GOAL_PERFORMANCE_TOOL,
} from "../../supabase/functions/_shared/agent/core/ProtectedAnalyticalRouting";
import { resolveAnalyticalPlan } from "../../supabase/functions/_shared/agent/core/AnalyticalQueryPlanner";
import { runAnalysisGates, gatesPassed, failedGates } from "../../supabase/functions/_shared/agent/core/AnalysisGates";
import { AGENT_RUNTIME_VERSION, ANALYTICAL_CONTRACT_VERSION } from "../../supabase/functions/_shared/agent/core/RuntimeContract";

const NOW = new Date("2026-08-20T12:00:00Z");

const INHERITED_SCOPE = {
  entity_type: "category" as const,
  selection: "explicit_ids" as const,
  entity_ids: ["c1", "c2", "c3"],
  entity_labels: ["Alimentação", "Transporte", "Lazer"],
  locked: true,
  aggregate_scope: "scoped_entities" as const,
  source: "engine_resolved" as const,
};

const INCIDENT_TEXT = "Comparando essas categorias com o mesmo período do mês anterior, como eu fui?";
const FULL_INCIDENT_TEXT = "Nino, me traga um overview das minhas metas no mês atual, se eu atingi ela ou ultrapassei, e compare essas mesmas categorias com o mesmo período do mês passado. Quero saber se, mesmo ultrapassando algumas metas, se ainda fiquei abaixo do gasto nessas mesmas categorias no mês anterior.";

describe("classificação de consulta analítica protegida", () => {
  it("protege a frase exata do incidente", () => {
    const c = classifyProtectedAnalytical({ text: INCIDENT_TEXT, previous_scope: INHERITED_SCOPE });
    expect(c.is_protected).toBe(true);
    expect(c.comparative).toBe(true);
    expect(c.anaphoric).toBe(true);
    expect(c.reason).toBe("anaphoric_comparison");
  });

  it("protege follow-up elíptico quando existe escopo herdado", () => {
    const c = classifyProtectedAnalytical({ text: "e comparado ao mês passado?", previous_scope: INHERITED_SCOPE });
    expect(c.is_protected).toBe(true);
    expect(c.reason).toBe("inherited_scope_comparison");
  });

  it("é anafórica e protegida mesmo SEM escopo (fail-closed, não agregado)", () => {
    const c = classifyProtectedAnalytical({ text: INCIDENT_TEXT, previous_scope: null });
    expect(c.is_protected).toBe(true);
    expect(c.scope_available).toBe(false);
  });

  it("não protege comparação global legítima", () => {
    const c = classifyProtectedAnalytical({ text: "compare meu gasto total com o mês passado", previous_scope: null });
    expect(c.is_protected).toBe(false);
    expect(c.reason).toBe("no_subject");
  });

  it("não protege conversa sem comparação", () => {
    expect(classifyProtectedAnalytical({ text: "bom dia, tudo bem?" }).is_protected).toBe(false);
  });
});

describe("allowlist de motor", () => {
  it("goal_performance_analysis só aceita assess_goal_performance", () => {
    expect(allowedEnginesFor("goal_performance_analysis")).toEqual([GOAL_PERFORMANCE_TOOL]);
    for (const tool of FORBIDDEN_SUBSTITUTE_TOOLS) {
      expect(isForbiddenSubstitute("goal_performance_analysis", tool)).toBe(true);
    }
    expect(isForbiddenSubstitute("goal_performance_analysis", GOAL_PERFORMANCE_TOOL)).toBe(false);
  });
});

describe("plano analítico para a pergunta do incidente", () => {
  it("protege a frase completa do print em um único turno", () => {
    const classification = classifyProtectedAnalytical({ text: FULL_INCIDENT_TEXT, previous_scope: null });
    const plan = resolveAnalyticalPlan({ text: FULL_INCIDENT_TEXT, previous_scope: null, now: NOW });
    expect(classification.is_protected).toBe(true);
    expect(plan?.protected_route).toBe(true);
    expect(plan?.engines.map((engine) => engine.tool)).toEqual([GOAL_PERFORMANCE_TOOL]);
    expect(plan?.scope.aggregate_scope).toBe("scoped_entities");
    expect(plan?.periods.current).toMatchObject({ from: "2026-08-01", to: "2026-08-20" });
    expect(plan?.periods.comparison).toMatchObject({ from: "2026-07-01", to: "2026-07-20" });
  });
  it("casa o plano, preserva os IDs herdados e usa a ferramenta canônica", () => {
    const plan = resolveAnalyticalPlan({ text: INCIDENT_TEXT, previous_scope: INHERITED_SCOPE, now: NOW });
    expect(plan).not.toBeNull();
    expect(plan!.primary_intent).toBe("goal_performance_analysis");
    expect(plan!.protected_route).toBe(true);
    expect(plan!.engines[0].tool).toBe(GOAL_PERFORMANCE_TOOL);
    expect(plan!.scope.entity_ids).toEqual(INHERITED_SCOPE.entity_ids);
    expect(plan!.scope.aggregate_scope).toBe("scoped_entities");
    expect(plan!.expected_entity_ids).toEqual(INHERITED_SCOPE.entity_ids);
    expect(plan!.engines[0].args.category_ids).toEqual(INHERITED_SCOPE.entity_ids);
  });

  it("compara agosto contra julho — nunca maio/junho", () => {
    const plan = resolveAnalyticalPlan({ text: INCIDENT_TEXT, previous_scope: INHERITED_SCOPE, now: NOW })!;
    expect(plan.periods.current.from.slice(0, 7)).toBe("2026-08");
    expect(plan.periods.comparison?.from.slice(0, 7)).toBe("2026-07");
    expect(plan.periods.comparison?.to.slice(0, 7)).toBe("2026-07");
  });

  it("follow-up elíptico curto também casa plano composto", () => {
    const plan = resolveAnalyticalPlan({ text: "e comparado ao mês passado?", previous_scope: INHERITED_SCOPE, now: NOW });
    expect(plan).not.toBeNull();
    expect(plan!.engines[0].tool).toBe(GOAL_PERFORMANCE_TOOL);
    expect(plan!.expected_entity_ids).toEqual(INHERITED_SCOPE.entity_ids);
  });
});

describe("gate entity_set_identity", () => {
  const base = (ids: string[]) => ({
    period: { current: { from: "2026-08-01", to: "2026-08-20" }, comparison: { from: "2026-07-01", to: "2026-07-20" }, comparison_basis: "calendar_previous_month" },
    freshness: { stale: false },
    confidence: "high",
    conclusions: { below_count: ids.length, above_count: 0, equal_count: 0, material_improvement_count: 0, material_worsening_count: 0 },
    categories: ids.map((id) => ({
      category_id: id, category_name: id, period_compatibility: "compatible",
      goal: { status: "achieved", actual: 100 },
      historical: { current: 100, previous: 200, delta: -100, direction: "below", materiality: "immaterial_change", trend: "improved" },
      interpretation: { state: "goal_achieved_and_improved" },
      goal_period: { from: "2026-08-01", to: "2026-08-20" }, analysis_period: { from: "2026-08-01", to: "2026-08-20" },
    })),
    aggregate: {
      scope: "scoped_entities", entity_ids: ids,
      current_spend: 100 * ids.length, previous_spend: 200 * ids.length,
      vs_previous: -100 * ids.length, direction: "below",
    },
  });

  const scope = { ...INHERITED_SCOPE };

  it("passa quando a evidência é exatamente o conjunto pedido", () => {
    const gates = runAnalysisGates({
      assessment: base(["c1", "c2", "c3"]) as any, scope, requirements: [],
      comparison_requested: true,
      expected_current_period: { from: "2026-08-01", to: "2026-08-20" },
      expected_comparison_period: { from: "2026-07-01", to: "2026-07-20" },
      expected_comparison_basis: "calendar_previous_month",
      expected_entity_ids: ["c1", "c2", "c3"],
    });
    expect(gatesPassed(gates)).toBe(true);
  });

  it("bloqueia quando a evidência trouxe outro conjunto (escopo trocado)", () => {
    const gates = runAnalysisGates({
      assessment: base(["c1", "c9"]) as any, scope, requirements: [],
      comparison_requested: true,
      expected_current_period: { from: "2026-08-01", to: "2026-08-20" },
      expected_comparison_period: { from: "2026-07-01", to: "2026-07-20" },
      expected_entity_ids: ["c1", "c2", "c3"],
    });
    expect(failedGates(gates).map((g) => g.gate)).toContain("entity_set_identity");
  });

  it("bloqueia período divergente do plano (julho vs maio/junho)", () => {
    const gates = runAnalysisGates({
      assessment: base(["c1", "c2", "c3"]) as any, scope, requirements: [],
      comparison_requested: true,
      expected_current_period: { from: "2026-08-01", to: "2026-08-20" },
      expected_comparison_period: { from: "2026-05-01", to: "2026-06-30" },
      expected_entity_ids: ["c1", "c2", "c3"],
    });
    expect(failedGates(gates).map((g) => g.gate)).toContain("comparison_contract_consistent");
  });
});

describe("contrato de runtime", () => {
  it("expõe versões estampadas em cada run", () => {
    expect(AGENT_RUNTIME_VERSION).toBe("nino-agent-p0.2026-09-01.4");
    expect(ANALYTICAL_CONTRACT_VERSION).toBe("nino_analytical.v2");
  });
});

// ---- Reprodução de DOIS TURNOS do incidente real -------------------------
describe("incidente em dois turnos (overview → comparação anafórica)", () => {
  it("turno 1 grava o escopo do fluxo antigo e turno 2 roda o motor canônico com os mesmos IDs", async () => {
    const { scopeFromToolCalls } = await import(
      "../../supabase/functions/_shared/agent/core/ScopeCarryover"
    );

    // Turno 1: pergunta de overview respondida pelo fluxo ANTIGO (get_goals_overview).
    const turn1Scope = scopeFromToolCalls([{
      name: "get_goals_overview",
      result: {
        goals: [
          { category_id: "c1", category_name: "Alimentação" },
          { category_id: "c2", category_name: "Transporte" },
          { category_id: "c3", category_name: "Lazer" },
        ],
      },
    }] as any);
    expect(turn1Scope?.entity_ids).toEqual(["c1", "c2", "c3"]);

    // Turno 2: a frase do incidente. Nunca pode virar agregado global,
    // nunca pode comparar julho contra maio/junho, nunca pode usar substituto.
    const classification = classifyProtectedAnalytical({ text: INCIDENT_TEXT, previous_scope: turn1Scope });
    expect(classification.is_protected).toBe(true);

    const plan = resolveAnalyticalPlan({ text: INCIDENT_TEXT, previous_scope: turn1Scope, now: NOW })!;
    expect(plan.engines[0].tool).toBe(GOAL_PERFORMANCE_TOOL);
    expect(plan.scope.aggregate_scope).toBe("scoped_entities");
    expect(plan.expected_entity_ids).toEqual(["c1", "c2", "c3"]);
    expect(plan.periods.current.from.slice(0, 7)).toBe("2026-08");
    expect(plan.periods.comparison!.from.slice(0, 7)).toBe("2026-07");
    for (const tool of FORBIDDEN_SUBSTITUTE_TOOLS) {
      expect(plan.engines.some((e) => e.tool === tool)).toBe(false);
      expect(isForbiddenSubstitute(plan.primary_intent, tool)).toBe(true);
    }
  });
});
