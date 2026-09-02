import { describe, expect, it } from "vitest";
import {
  classifyDialogueAct, findRepairBaseQuery, repairEffectiveQuery,
} from "../../supabase/functions/_shared/agent/core/DialogueAct";
import {
  capabilityFromFinancialIR, isFalseCapabilityDenial,
} from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import {
  fastFinancialIR, validateFinancialIR, type FinancialQueryIR,
} from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";
import { rolloutDecision } from "../../supabase/functions/_shared/agent/core/FeatureFlags";

const period = { from: "2026-06-04", to: "2026-09-01", label: "últimos 90 dias" };
const previous = { from: "2026-03-06", to: "2026-06-03", label: "90 dias anteriores" };

function ir(
  overrides: Partial<FinancialQueryIR["queries"][number]> = {},
  top: Partial<FinancialQueryIR> = {},
): FinancialQueryIR {
  return {
    version: "financial_query_ir.v1",
    intent: "analyze",
    needs_clarification: [],
    assumptions: [],
    queries: [{
      id: "q1",
      metric: "expense_amount",
      operation: "rank",
      group_by: ["category"],
      filters: [],
      limit: 5,
      ...overrides,
    }],
    completeness_targets: ["q1.result"],
    period,
    comparison_period: previous,
    source: "semantic_compiler",
    unsupported_reason: null,
    ...top,
  };
}

describe("nino_semantic_ir.v2", () => {
  it("golden #1: ranking de categorias -> analyze_spending com período exato", () => {
    const adapted = capabilityFromFinancialIR(ir());
    expect(adapted.unsupported_queries).toEqual([]);
    expect(adapted.capability?.required_tool).toBe("analyze_spending");
    expect(adapted.capability?.tool_args).toMatchObject({
      from: "2026-06-04",
      to: "2026-09-01",
      metric: "expense",
      group_by: "category",
      view: "rank",
      limit: 5,
    });
  });

  it("correção 'por cartão' vira dimensão card e não filtro descartado", () => {
    const adapted = capabilityFromFinancialIR(ir({ group_by: ["card"], filters: [] }));
    expect(adapted.capability?.tool_args).toMatchObject({
      group_by: "card",
      payment_method: "credit_card",
    });
  });

  it("filtro específico de cartão chega ao argumento final da tool", () => {
    const adapted = capabilityFromFinancialIR(ir({
      group_by: ["category"],
      filters: [{ field: "card", op: "eq", value: "Nubank" }],
    }));
    expect(adapted.capability?.tool_args).toMatchObject({ card: "Nubank" });
  });

  it("filtro específico de categoria chega ao argumento final da tool", () => {
    const adapted = capabilityFromFinancialIR(ir({
      filters: [{ field: "category", op: "eq", value: "Alimentação" }],
    }));
    expect(adapted.capability?.tool_args).toMatchObject({ category: "Alimentação" });
  });

  it("total de gasto sem group_by é coberto", () => {
    const adapted = capabilityFromFinancialIR(ir({
      operation: "sum", group_by: [], filters: [], limit: null,
    }));
    expect(adapted.capability?.required_tool).toBe("analyze_spending");
    expect(adapted.capability?.tool_args).toMatchObject({ metric: "expense", view: "total" });
  });

  it("income_amount é coberto", () => {
    const adapted = capabilityFromFinancialIR(ir({
      metric: "income_amount", operation: "sum", group_by: [], filters: [], limit: null,
    }));
    expect(adapted.capability?.required_tool).toBe("analyze_spending");
    expect(adapted.capability?.tool_args).toMatchObject({ metric: "income" });
  });

  it("trend de gasto usa motor de tendência existente", () => {
    const adapted = capabilityFromFinancialIR(ir({
      operation: "trend", group_by: [], filters: [], limit: null,
    }));
    expect(adapted.capability?.required_tool).toBe("spending_average_daily_trend");
  });

  it("forecast usa forecast_month_close", () => {
    const adapted = capabilityFromFinancialIR(ir({
      operation: "forecast", group_by: [], filters: [], limit: null,
    }));
    expect(adapted.capability?.required_tool).toBe("forecast_month_close");
  });

  it("explain usa os dois períodos canônicos", () => {
    const adapted = capabilityFromFinancialIR(ir({
      operation: "explain", group_by: [], filters: [], limit: null,
    }, { intent: "investigate" }));
    expect(adapted.capability?.required_tool).toBe("explain_spending_change");
    expect(adapted.capability?.tool_args).toMatchObject({
      period_a: { from: previous.from, to: previous.to },
      period_b: { from: period.from, to: period.to },
    });
  });

  it("nunca executa parcialmente filtro que o motor não suporta", () => {
    const bad = ir({
      operation: "compare",
      filters: [{ field: "card", op: "eq", value: "Nubank" }],
      group_by: [],
    });
    const adapted = capabilityFromFinancialIR(bad);
    expect(adapted.capability).toBeNull();
    expect(adapted.unsupported_queries).toEqual(["q1"]);
  });

  it("v1 rejeita duas queries em vez de responder metade", () => {
    const value = ir() as any;
    value.queries.push({ ...value.queries[0], id: "q2", metric: "income_amount" });
    expect(validateFinancialIR(value)).toContain("v1_requires_exactly_one_query");
  });

  it("golden #2: repair preserva pergunta anterior", () => {
    const act = classifyDialogueAct("Não foi isso que eu perguntei", { kind: "unknown", text: "x" });
    const base = findRepairBaseQuery([
      { role: "user", content: "Quais categorias eu tenho gastado mais nos últimos 90 dias?" },
      { role: "assistant", content: "..." },
    ], "Não foi isso que eu perguntei");
    expect(base).toMatch(/categorias/i);
    expect(repairEffectiveQuery({
      current: "Não foi isso que eu perguntei", previous_user_query: base, act,
    })).toContain("CORREÇÃO DO USUÁRIO");
  });

  it("negative repair: 'não foi fácil' NÃO é correção", () => {
    const act = classifyDialogueAct(
      "Não foi fácil, mas consegui economizar este mês",
      { kind: "unknown", text: "x" },
    );
    expect(act.repair).toBe(false);
  });

  it("negative repair: negação de capacidade pessoal NÃO é correção", () => {
    const act = classifyDialogueAct(
      "Não consigo gastar assim todo mês",
      { kind: "unknown", text: "x" },
    );
    expect(act.repair).toBe(false);
  });

  it("fast path continua covarde", () => {
    expect(fastFinancialIR("qual meu saldo?", period)?.queries[0].metric).toBe("balance");
    expect(fastFinancialIR("quais categorias mais gastei nos últimos 90 dias?", period)).toBeNull();
  });

  it("capability guard bloqueia falsa incapacidade quando há mapping completo", () => {
    expect(isFalseCapabilityDenial("Não tenho ferramenta para consolidar isso.", ir())).toBe(true);
  });

  it("rollout 0% só libera piloto", () => {
    const cfg = { enabled: true, rollout_percent: 0, pilot_user_ids: ["00000000-0000-0000-0000-000000000001"] };
    expect(rolloutDecision("semantic_ir_v1", "00000000-0000-0000-0000-000000000001", cfg)).toBe(true);
    expect(rolloutDecision("semantic_ir_v1", "00000000-0000-0000-0000-000000000002", cfg)).toBe(false);
  });

  it("flag disabled bloqueia até piloto", () => {
    const cfg = { enabled: false, rollout_percent: 100, pilot_user_ids: ["00000000-0000-0000-0000-000000000001"] };
    expect(rolloutDecision("semantic_ir_v1", "00000000-0000-0000-0000-000000000001", cfg)).toBe(false);
  });
});
