// Autocorreção limitada (`nino_self_repair.v1`): só leitura que falhou por falta de motor/gate, uma vez.
import { describe, expect, it } from "vitest";
import {
  isRepairableFailure, isTransientInterpreterFailure, selfRepairHint,
} from "../../supabase/functions/_shared/agent/core/SelfRepair";

const read = (error: string | null, domain = "financial_read", mode = "read") =>
  ({ contract: { domain, mode }, error, reply_kind: "info" });

describe("autocorreção", () => {
  it("repara leitura sem motor, com gate barrando ou sem plano executado", () => {
    expect(isRepairableFailure(read("semantic_unsupported:unsupported_required_query:q1"))).toBe(true);
    expect(isRepairableFailure(read("semantic_gate_blocked"))).toBe(true);
    expect(isRepairableFailure(read("preservation:metric:q1:executed_ir_missing"))).toBe(true);
  });

  it("nunca repara escrita, conversa, aviso nem execução sem erro", () => {
    expect(isRepairableFailure(read("semantic_gate_blocked", "financial_write", "write"))).toBe(false);
    expect(isRepairableFailure(read("semantic_gate_blocked", "conversation", "converse"))).toBe(false);
    expect(isRepairableFailure(read("semantic_gate_blocked", "advisory", "read"))).toBe(false);
    expect(isRepairableFailure(read(null))).toBe(false);
    expect(isRepairableFailure(read("category_not_found"))).toBe(false);
  });

  it("a dica traz o motivo, a lista executável e a saída honesta", () => {
    const hint = selfRepairHint("semantic_unsupported:unsupported_required_query:q1");
    expect(hint).toContain("não tem motor");
    expect(hint).toContain("expense_amount");
    expect(hint).toContain("kind=conversation");
  });

  it("falha transitória do provedor vale nova tentativa; erro de regra não", () => {
    expect(isTransientInterpreterFailure("semantic_tiers_unavailable:structured_call_gateway_400:structured_call_gateway_400")).toBe(true);
    expect(isTransientInterpreterFailure("v3_plan_rejected:temporal_expression_unresolved:próximos 10 dias")).toBe(false);
    expect(isTransientInterpreterFailure(null)).toBe(false);
  });
});

import { selectStageForAdvice } from "../../supabase/functions/_shared/agent/behaviorWealth";

describe("conselho com conciliação pendente", () => {
  const base = {
    truth_blocked: true, available_today: 6000, projected_month_end_available: 2000, monthly_income: 8000,
    monthly_debt_installments: 3700, has_active_goal: false, sustainable_monthly_saving: 0,
  };
  it("não vira beco sem saída: protege caixa/dívida com ressalva", () => {
    const out = selectStageForAdvice(base);
    expect(out.stage).toBe("reduce_debt_pressure");
    expect(out.truth_caveat).toBe(true);
    expect(selectStageForAdvice({ ...base, available_today: -10 }).stage).toBe("stabilize_cash");
  });
  it("recomendação patrimonial continua bloqueada pela conciliação", () => {
    const out = selectStageForAdvice({ ...base, monthly_debt_installments: 0, sustainable_monthly_saving: 900, has_active_goal: true });
    expect(out.stage).toBe("repair_truth");
    expect(out.truth_caveat).toBe(false);
  });
  it("sem bloqueio, o estágio é o de sempre", () => {
    expect(selectStageForAdvice({ ...base, truth_blocked: false })).toMatchObject({ stage: "reduce_debt_pressure", truth_caveat: false });
  });
});

import { buildCashHorizon } from "../../supabase/functions/_shared/proactive/cashHorizon";
describe("regressões da medição real", () => {
  it("o conjunto não depende de valores reais e o horizonte de caixa segue puro", () => {
    expect(buildCashHorizon({ today: "2026-10-29", availableToday: 100, incomeEvents: [], commitments: [] })).toEqual([]);
  });
});
