// Regressão P0 do caminho analítico: escopo, período e ferramenta.
//
// O bug real em produção: "Comparando essas categorias com o mesmo período do
// mês anterior, eu melhorei ou piorei?" caiu no fluxo antigo
// (`compare_financial_metric`, escopo global, julho × 31/05–30/06) porque:
//  1. o planner exigia a palavra "meta" no texto do turno atual;
//  2. o escopo de categorias não sobrevivia a um turno respondido pelo fluxo antigo;
//  3. nada rejeitava evidência de outro escopo/período;
//  4. `CUSTOM_PERIOD` escolhia janela deslizante silenciosamente.
import { describe, expect, it } from "vitest";
import { resolveAnalyticalPlan } from "../../supabase/functions/_shared/agent/core/AnalyticalQueryPlanner";
import { scopeFromToolCalls } from "../../supabase/functions/_shared/agent/core/ScopeCarryover";
import {
  reconcileEvidence, replyUsesRejectedEvidence, citedValues,
} from "../../supabase/functions/_shared/agent/core/EvidenceReconciliation";
import { computeFinancialComparison } from "../lib/engine/financialComparison";
import type { AnalysisScope } from "../../supabase/functions/_shared/agent/core/ScopeResolver";

const NOW = new Date("2026-08-31T12:00:00Z");

const inheritedScope: AnalysisScope = {
  entity_type: "category",
  selection: "explicit_ids",
  entity_ids: ["cat-food", "cat-transport", "cat-fun", "cat-home"],
  entity_labels: ["Alimentação", "Transporte", "Lazer", "Casa"],
  aggregate_scope: "scoped_entities",
  source: "engine_resolved",
  locked: true,
};

// --------------------------------------------------------------- Fase 1
describe("analytical_plan.v1 — escopo herdado", () => {
  const TEXT = "Comparando essas categorias com o mesmo período do mês anterior, eu melhorei ou piorei?";

  it("sem contexto anterior, não inventa análise composta", () => {
    expect(resolveAnalyticalPlan({ text: TEXT, now: NOW, previous_scope: null })).toBeNull();
  });

  it("com escopo herdado de categorias, monta o plano composto sem a palavra meta", () => {
    const plan = resolveAnalyticalPlan({ text: TEXT, now: NOW, previous_scope: inheritedScope });
    expect(plan).not.toBeNull();
    expect(plan!.primary_intent).toBe("goal_performance_analysis");
    expect(plan!.engines[0].tool).toBe("assess_goal_performance");
    expect(plan!.scope.entity_ids).toEqual(inheritedScope.entity_ids);
    expect(plan!.scope.aggregate_scope).toBe("scoped_entities");
    expect(plan!.scope.locked).toBe(true);
    expect(plan!.engines[0].args.category_ids).toEqual(inheritedScope.entity_ids);
    expect(plan!.periods.comparison).not.toBeNull();
  });

  it("período do turno é agosto e a comparação é julho — nunca junho", () => {
    const plan = resolveAnalyticalPlan({
      text: TEXT, now: NOW, previous_scope: inheritedScope,
      turn_period: { from: "2026-08-01", to: "2026-08-31" },
    })!;
    expect(plan.periods.current.from).toBe("2026-08-01");
    expect(plan.periods.comparison!.from.slice(0, 7)).toBe("2026-07");
    expect(plan.periods.comparison_basis).toBe("calendar_previous_month");
  });

  it("recorte parcial pedido como mês passado preserva os dias do mês anterior", () => {
    const plan = resolveAnalyticalPlan({
      text: "Compare essas categorias de 16 a 31 de agosto com o mesmo período do mês passado",
      now: NOW,
      previous_scope: inheritedScope,
      turn_period: { from: "2026-08-16", to: "2026-08-31" },
    });
    expect(plan?.periods.comparison).toEqual({ from: "2026-07-16", to: "2026-07-31" });
    expect(plan?.periods.comparison_basis).toBe("calendar_previous_month");
  });
});

describe("nino_scope.v2 — escopo sobrevive ao turno antigo", () => {
  it("extrai categorias de get_goals_overview respondido pelo fluxo antigo", () => {
    const scope = scopeFromToolCalls([{
      tool_name: "get_goals_overview",
      ok: true,
      result: {
        category_goals: [
          { id: "g1", category_id: "cat-food", name: "Alimentação" },
          { id: "g2", category_id: "cat-fun", name: "Lazer" },
        ],
      },
    }]);
    expect(scope?.entity_ids).toEqual(["cat-food", "cat-fun"]);
    expect(scope?.entity_labels).toEqual(["Alimentação", "Lazer"]);
    expect(scope?.locked).toBe(true);
  });

  it("turno sem categoria concreta não grava escopo falso", () => {
    expect(scopeFromToolCalls([{ tool_name: "get_financial_snapshot", ok: true, result: { balance: 10 } }])).toBeNull();
  });

  it("o escopo herdado gerado reativa o plano composto no turno seguinte", () => {
    const scope = scopeFromToolCalls([{
      tool_name: "get_goals_overview", ok: true,
      result: { category_goals: [{ category_id: "cat-food", name: "Alimentação" }] },
    }])!;
    const plan = resolveAnalyticalPlan({
      text: "e nessas mesmas categorias eu melhorei em relação ao mês anterior?",
      now: NOW, previous_scope: scope,
    });
    expect(plan?.engines[0].tool).toBe("assess_goal_performance");
  });
});

// --------------------------------------------------------------- Fase 2
describe("nino_evidence.v1 — gates de escopo e período", () => {
  const turnPeriod = { from: "2026-08-01", to: "2026-08-31" };

  it("rejeita agregado global sob escopo de categorias", () => {
    const report = reconcileEvidence({
      toolCalls: [{
        tool_name: "compare_financial_metric", ok: true,
        result: { scope: "overall", current: { value: 36550.23 }, evidence: { current_period: turnPeriod } },
      }],
      scope: inheritedScope,
      period: turnPeriod,
    });
    expect(report.kept).toHaveLength(0);
    expect(report.rejected[0].reason).toBe("scope_global_under_scoped_intent");
    expect(report.poisoned_values).toContain(36550.23);
  });

  it("rejeita evidência de outro período no mesmo turno", () => {
    const report = reconcileEvidence({
      toolCalls: [{
        tool_name: "compare_financial_metric", ok: true,
        result: {
          scope: "category", subject_id: "cat-food", current: { value: 36550.23 },
          evidence: { current_period: { from: "2026-07-01", to: "2026-07-31" } },
        },
      }],
      scope: null,
      period: turnPeriod,
    });
    expect(report.rejected[0].reason).toBe("period_mismatch");
  });

  it("mantém evidência do escopo e período pedidos", () => {
    const report = reconcileEvidence({
      toolCalls: [{
        tool_name: "assess_goal_performance", ok: true,
        result: {
          aggregate: { scope: "scoped_entities", current: 4820.5 },
          evidence: { current_period: turnPeriod },
        },
      }],
      scope: inheritedScope,
      period: turnPeriod,
    });
    expect(report.rejected).toHaveLength(0);
    expect(report.kept).toHaveLength(1);
    expect(report.poisoned_values).toHaveLength(0);
  });

  it("resposta que cita o número descartado é bloqueada", () => {
    const report = reconcileEvidence({
      toolCalls: [{
        tool_name: "compare_financial_metric", ok: true,
        result: { scope: "overall", current: { value: 36550.23 }, evidence: { current_period: turnPeriod } },
      }],
      scope: inheritedScope,
      period: turnPeriod,
    });
    expect(replyUsesRejectedEvidence("Você gastou R$ 36.550,23 neste recorte.", report)).toBe(true);
    expect(replyUsesRejectedEvidence("Suas metas seguem dentro do teto.", report)).toBe(false);
  });

  it("lê valores em reais no formato pt-BR", () => {
    expect(citedValues("subiu de R$ 1.234,56 para R$ 2.000,00")).toEqual([1234.56, 2000]);
  });
});

// --------------------------------------------------------------- Fase 3
describe("financialComparison — base de comparação explícita", () => {
  const base = { txs: [] as never[], metric: "expense" as const, as_of: "2026-08-31" };

  it("mês calendário atual compara com o mesmo recorte do mês anterior", () => {
    const r = computeFinancialComparison({
      ...base, mode: "CUSTOM_PERIOD",
      current_period: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(r.comparison_basis).toBe("calendar_previous_month");
    expect(r.previous.from).toBe("2026-06-01");
    expect(r.previous.to).toBe("2026-06-30");
  });

  it("janela deslizante só quando pedida explicitamente", () => {
    const r = computeFinancialComparison({
      ...base, mode: "CUSTOM_PERIOD",
      current_period: { from: "2026-07-01", to: "2026-07-31" },
      comparison_basis: "preceding_window",
    });
    expect(r.comparison_basis).toBe("preceding_window");
    expect(r.previous.from).toBe("2026-05-31");
    expect(r.previous.to).toBe("2026-06-30");
  });

  it("período que atravessa meses continua usando janela anterior de mesmo tamanho", () => {
    const r = computeFinancialComparison({
      ...base, mode: "CUSTOM_PERIOD",
      current_period: { from: "2026-07-15", to: "2026-08-14" },
    });
    expect(r.comparison_basis).toBe("preceding_window");
  });

  it("compra de cartão de 30/07 na fatura de agosto conta em agosto", () => {
    const tx = {
      id: "t1", user_id: "u", amount: 300, type: "expense", status: "confirmed",
      occurred_at: "2026-07-30", competence_date: "2026-08-05", payment_method: "credit_card",
      credit_card_id: "card-1", category_id: "cat-food", description: "Mercado",
      movement_kind: "transaction",
    } as never;
    const r = computeFinancialComparison({
      txs: [tx], metric: "expense", as_of: "2026-08-31", mode: "CUSTOM_PERIOD",
      current_period: { from: "2026-08-01", to: "2026-08-31" },
    });
    expect(r.current.value).toBe(300);
    expect(r.previous.value).toBe(0);
  });
});
