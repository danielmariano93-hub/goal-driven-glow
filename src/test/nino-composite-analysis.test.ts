// Regressões `nino_composite.v1`: escopo preservado, meta != evolução,
// completude verificável e conclusão determinística.
import { describe, expect, it } from "vitest";
import {
  detectFacets, detectDomains, resolveAnalyticalPlan,
} from "../../supabase/functions/_shared/agent/core/AnalyticalQueryPlanner";
import {
  checkScopePreservation, goalCategoryScope, resolveScope, mentionsScopeAnaphora, bindEntities,
} from "../../supabase/functions/_shared/agent/core/ScopeResolver";
import { resolveInterpretation } from "../../supabase/functions/_shared/agent/core/InterpretationResolver";
import { runAnalysisGates, gatesPassed } from "../../supabase/functions/_shared/agent/core/AnalysisGates";
import {
  checkCompleteness, evaluateRequirements, stripUnwantedContinuation,
} from "../../supabase/functions/_shared/agent/core/AnswerCompleteness";
import { computeGoalPerformanceAssessment, samePeriodPreviousMonth, classifyTrend, crossState } from "../lib/engine/goalPerformanceAssessment";

const NOW = new Date("2026-08-20T12:00:00");
const CASE = "Me traga um overview das minhas metas, diga se eu atingi e compare essas mesmas categorias com o mês passado";

function category(over: Record<string, unknown> = {}) {
  return {
    category_id: "c1",
    category_name: "Alimentação",
    goal: { status: "missed", target: 800, actual: 900 },
    historical: { trend: "improved", current: 900, previous: 1200, delta: -300, direction: "below", materiality: "material_improvement", confidence: "high" },
    interpretation: { state: "goal_missed_but_improved" },
    ...over,
  };
}

function assessment(categories: any[] = [category()]) {
  return {
    formula_version: "goal_performance_assessment.v1",
    period: { current: { from: "2026-08-01", to: "2026-08-20" }, comparison: { from: "2026-07-01", to: "2026-07-20" }, comparison_basis: "calendar_previous_month" },
    freshness: { ledger_version: 3, computed_at: NOW.toISOString(), source: "ledger", stale: false },
    categories,
    aggregate: {
      scope: "scoped_entities", entity_ids: categories.map((c) => c.category_id),
      total_target: 800, current_spend: 900, previous_spend: 1200,
      vs_target: 100, vs_target_pct: 12.5, vs_previous: -300, vs_previous_pct: -25, direction: "below",
    },
    conclusions: {
      goals_total: categories.length, goals_achieved: 0, goals_missed: categories.length,
      improved_count: categories.length, worsened_count: 0,
      below_count: categories.length, above_count: 0, equal_count: 0,
      material_improvement_count: categories.length, material_worsening_count: 0,
      goal_attainment_summary: "", behavioral_evolution: "improving",
      strongest_improvement: { category_name: "Alimentação", delta: -300 },
      strongest_deterioration: null,
      priority: { category_name: "Alimentação", reason: "ainda acima do teto" },
    },
    confidence: "high",
    data_quality: { goals_evaluated: categories.length, transactions_considered: 40, comparable_periods: true },
    evidence: [],
    formula_versions: ["goal_performance_assessment.v1"],
  };
}

describe("AnalyticalQueryPlanner", () => {
  it("decompõe a pergunta real em facetas e domínios", () => {
    const facets = detectFacets(CASE);
    expect(facets).toContain("overview");
    expect(facets).toContain("attainment");
    expect(facets).toContain("comparison");
    expect(detectDomains(CASE)).toContain("goals");
  });

  it("monta plano composto com período de comparação e requisitos por entidade", () => {
    const plan = resolveAnalyticalPlan({ text: CASE, now: NOW })!;
    expect(plan).toBeTruthy();
    expect(plan.composite).toBe(true);
    expect(plan.periods.comparison).toBeTruthy();
    expect(plan.requested_answers).toContain("historical_comparison_per_entity");
    expect(plan.requested_answers).toContain("scoped_aggregate");
    expect(plan.scope.locked).toBe(true);
    expect(plan.engines[0].tool).toBe("assess_goal_performance");
  });

  it("não captura pedido simples de lançamento nem conversa", () => {
    expect(resolveAnalyticalPlan({ text: "gastei 40 no mercado", now: NOW })).toBeNull();
    expect(resolveAnalyticalPlan({ text: "bom dia, tudo bem?", now: NOW })).toBeNull();
  });
});

describe("ScopeResolver", () => {
  it("reconhece anáfora de conjunto de forma generalizável", () => {
    for (const t of ["compare essas mesmas categorias", "e nelas?", "dessas metas, qual piorou?", "só as que estouraram"]) {
      expect(mentionsScopeAnaphora(t)).toBe(true);
    }
  });

  it("herda o escopo anterior em vez de virar global", () => {
    const previous = bindEntities(goalCategoryScope(), [{ id: "c1", label: "Alimentação" }]);
    const next = resolveScope({ text: "e nessas mesmas?", previous });
    expect(next.entity_ids).toEqual(["c1"]);
    expect(next.aggregate_scope).toBe("scoped_entities");
    expect(next.source).toBe("inherited_from_turn");
  });

  it("reprova agregado global quando o escopo está travado", () => {
    expect(checkScopePreservation(goalCategoryScope(), { scope: "global" })).toEqual({
      gate: "scope_preserved", expected: "scoped_entities", found: "global",
    });
    expect(checkScopePreservation(goalCategoryScope(), { scope: "scoped_entities" })).toBeNull();
  });
});

describe("InterpretationResolver", () => {
  it("separa meta estourada de piora comportamental", () => {
    const r = resolveInterpretation(assessment());
    expect(r.state).toBe("improving_despite_goal_misses");
    expect(r.conclusion).toMatch(/menos que no mesmo per[íi]odo anterior/i);
  });

  it("meta cumprida com gasto maior não vira melhora", () => {
    const changed = assessment([category({
      goal: { status: "achieved", target: 1000, actual: 900 },
      historical: { trend: "worsened", current: 900, previous: 600, delta: 300, direction: "above", materiality: "material_worsening", confidence: "high" },
      interpretation: { state: "goal_achieved_but_worsened" },
    })]);
    changed.conclusions.goals_achieved = 1;
    changed.conclusions.goals_missed = 0;
    changed.conclusions.material_improvement_count = 0;
    changed.conclusions.material_worsening_count = 1;
    const r = resolveInterpretation(changed);
    expect(r.state).toBe("regressing_despite_goals_met");
  });

  it("sem histórico não afirma melhora", () => {
    const r = resolveInterpretation(assessment([category({
      historical: { trend: "insufficient_data", current: 900, previous: 0, delta: 900, direction: "above", materiality: "immaterial_change", confidence: "insufficient" },
    })]));
    expect(r.state).toBe("insufficient_data");
  });
});

describe("AnalysisGates", () => {
  it("aprova análise coerente", () => {
    const gates = runAnalysisGates({
      assessment: assessment(), scope: bindEntities(goalCategoryScope(), [{ id: "c1", label: "Alimentação" }]),
      requirements: [], comparison_requested: true, expected_entity_count: 1,
    });
    expect(gatesPassed(gates)).toBe(true);
  });

  it("bloqueia agregado global sob escopo travado", () => {
    const bad = assessment();
    (bad.aggregate as any).scope = "global";
    const gates = runAnalysisGates({
      assessment: bad, scope: goalCategoryScope(), requirements: [], comparison_requested: true,
    });
    expect(gates.find((g) => g.gate === "scope_preserved")!.ok).toBe(false);
  });

  it("bloqueia evidência stale afirmada com confiança alta", () => {
    const stale = assessment();
    (stale.freshness as any).stale = true;
    const gates = runAnalysisGates({
      assessment: stale, scope: goalCategoryScope(), requirements: [], comparison_requested: true,
    });
    expect(gates.find((g) => g.gate === "evidence_fresh")!.ok).toBe(false);
  });

  it("bloqueia comparação ausente quando ela foi pedida", () => {
    const noCompare = assessment([category({ historical: { trend: "improved", current: 900, confidence: "low" } })]);
    const gates = runAnalysisGates({
      assessment: noCompare, scope: goalCategoryScope(), requirements: [], comparison_requested: true,
    });
    expect(gates.find((g) => g.gate === "comparison_present")!.ok).toBe(false);
  });

  it("bloqueia agregado que não reconcilia com os itens", () => {
    const bad = assessment();
    bad.aggregate.current_spend = 950;
    const gates = runAnalysisGates({ assessment: bad, scope: goalCategoryScope(), requirements: [], comparison_requested: true });
    expect(gates.find((g) => g.gate === "arithmetic_consistent")?.ok).toBe(false);
  });

  it("bloqueia contagem que contradiz as categorias", () => {
    const bad = assessment();
    bad.conclusions.above_count = 2;
    const gates = runAnalysisGates({ assessment: bad, scope: goalCategoryScope(), requirements: [], comparison_requested: true });
    expect(gates.find((g) => g.gate === "counts_consistent")?.ok).toBe(false);
  });
});

describe("AnswerCompleteness", () => {
  it("marca resposta completa quando todas as entidades foram cobertas", () => {
    const plan = resolveAnalyticalPlan({ text: CASE, now: NOW })!;
    const reqs = evaluateRequirements(plan.requirements, assessment(), { comparison_requested: true });
    const report = checkCompleteness(reqs);
    expect(report.status).toBe("complete");
    expect(report.disclosure).toBeNull();
  });

  it("acusa parcialidade quando falta comparação de uma categoria", () => {
    const plan = resolveAnalyticalPlan({ text: CASE, now: NOW })!;
    const partial = assessment([
      category(),
      category({ category_id: "c2", category_name: "Transporte", historical: { trend: "insufficient_data", current: 100, confidence: "low" } }),
    ]);
    const reqs = evaluateRequirements(plan.requirements, partial, { comparison_requested: true });
    const report = checkCompleteness(reqs);
    expect(report.status).toBe("partial");
    expect(report.disclosure).toBeTruthy();
  });

  it("remove convite de continuação quando tudo já foi respondido", () => {
    const out = stripUnwantedContinuation("Resposta completa.\nQuer ver o detalhe de outra categoria?", { entitiesFullyCovered: true });
    expect(out).toBe("Resposta completa.");
  });
});

describe("goal_performance_assessment.v1", () => {
  it("desloca o mesmo recorte para o mês anterior", () => {
    expect(samePeriodPreviousMonth({ from: "2026-08-01", to: "2026-08-20" })).toEqual({ from: "2026-07-01", to: "2026-07-20" });
  });

  it("classifica tendência e cruzamento sem confundir meta com evolução", () => {
    expect(classifyTrend(900, 1200)).toBe("strongly_improved");
    expect(crossState("missed", "strongly_improved")).toBe("goal_missed_but_improved");
    expect(crossState("achieved", "worsened")).toBe("goal_achieved_but_worsened");
  });

  it("agrega só o escopo das categorias com meta", () => {
    const goals = [{
      id: "g1", user_id: "u1", category_id: "c1", mode: "fixed", reduction_pct: null, fixed_limit: 800,
      baseline_kind: "manual", baseline_value: 800, computed_limit: 800, frequency: "monthly",
      start_date: "2026-08-01", end_date: null, status: "active",
    }] as any;
    const txs = [
      { id: "t1", amount: 900, category_id: "c1", type: "expense", status: "confirmed", occurred_at: "2026-08-10" },
      { id: "t2", amount: 1200, category_id: "c1", type: "expense", status: "confirmed", occurred_at: "2026-07-10" },
      { id: "t3", amount: 5000, category_id: "c9", type: "expense", status: "confirmed", occurred_at: "2026-08-11" },
    ] as any;
    const out = computeGoalPerformanceAssessment({
      goals, txs, categoryNameById: { c1: "Alimentação", c9: "Outros" }, today: NOW,
      comparison: { from: "2026-07-01", to: "2026-07-20" },
    });
    expect(out.aggregate.scope).toBe("scoped_entities");
    expect(out.aggregate.current_spend).toBe(900);
    expect(out.aggregate.previous_spend).toBe(1200);
    expect(out.categories).toHaveLength(1);
  });
});
