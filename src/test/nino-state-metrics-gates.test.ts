// Regressão (WhatsApp, 01/10/2026): "qual meu saldo atual?" e "como está minha
// meta de alimentação?" respondiam "não consegui confirmar". A ferramenta
// buscava o dado certo; o gate de preservação (executed_ir_missing) e o de
// grounding (money_not_in_evidence) é que não sabiam validar métricas de ESTADO.
import { describe, expect, it } from "vitest";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { executedIRFrom } from "../../supabase/functions/_shared/agent/core/ExecutedIRBridge";
import { normalizeToV3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import { groundReply } from "../../supabase/functions/_shared/agent/core/GroundingGateV3";
import { buildEvidenceClaims } from "../../supabase/functions/_shared/agent/core/EvidenceClaims";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import { formatGoalsOverview } from "../../supabase/functions/_shared/agent/core/DeterministicAnswersImpl";

const NOW = new Date("2026-10-01T23:54:00Z");
const PERIOD = { from: "2026-10-01", to: "2026-10-01", label: "hoje" };

const ir = (metric: string, filters: unknown[] = []) => ({
  version: "financial_query_ir.v2", intent: "lookup",
  queries: [{ id: "q1", metric, operation: "value", filters, group_by: [], limit: null, depends_on: [] }],
  period: PERIOD, comparison_period: null, assumptions: [], needs_clarification: [], completeness_targets: [], source: "llm", unsupported_reason: null,
});

const snapshot = {
  available_today: 12345.67, current_month_income: 0, current_month_expense: 285.09, daily_pace: 285.09,
  typical_daily_pace: 300, projected_month_end_available: 9000, known_future_commitments: 1000, active_debts: [], card_due_this_month: 0,
};
const goalRow = { id: "g1", category_id: "c1", name: "Alimentação", type: "category", status: "on_track", target: 1000, achieved: 670.92, attainment_pct: 100, remaining: 329.08 };
const allGoals = {
  formula_version: "goals_overview.v2", month: "2026-10", items: [], shared_goals: [],
  category_goals: [goalRow, { ...goalRow, id: "g2", name: "Lazer", target: 500, achieved: 650, remaining: -150, attainment_pct: 76.92 }],
  overall_attainment_pct: 88.46,
};
const goalsOfCategory = {
  ...allGoals, category_goals: [{ ...goalRow, used_pct: 67, over_limit: false }],
  category_filter: { requested: "Alimentação", applied: true, matched: 1 },
  overall_attainment_pct: 100,
};

async function run(metric: string, result: unknown, filters: unknown[] = []) {
  return await runSemanticTurn({
    text: "pergunta", acts: ["read_financial"], constraints: { period: false, dimension: false, entity: false },
    period: PERIOD, comparison_period: null, topic_state: null, max_queries: 1, investigation_enabled: false,
    now: NOW, failure_reply: "falha", authoritative_contract: true, preservation_enforced: true,
  } as never, {
    compile: async () => ({ ir: ir(metric, filters) as never, telemetry: null }),
    loadOptions: async () => ["Alimentação"], recordStage: () => {},
    runEngine: async () => ({ ok: true, result, duration_ms: 5 }),
  } as never) as any;
}

describe("métricas de estado passam pelos gates com a evidência real", () => {
  it("saldo atual responde com o valor, sem preservation nem grounding violados", async () => {
    const out = await run("balance", snapshot);
    expect(out.errors).toEqual([]);
    expect(out.preservation?.compatible).toBe(true);
    expect(out.grounding?.ok).toBe(true);
    expect(out.turn?.reply).toContain("12.345,67");
  });

  it("visão geral de metas responde sem bloqueio", async () => {
    const out = await run("goal_progress", allGoals);
    expect(out.errors).toEqual([]);
    expect(out.preservation?.compatible).toBe(true);
    expect(out.grounding?.ok).toBe(true);
    expect(out.turn?.reply).toContain("Alimentação");
  });

  it("meta de UMA categoria: a engine aplica e confirma o filtro", async () => {
    const out = await run("goal_progress", goalsOfCategory, [{ field: "category", op: "eq", value: "Alimentação" }]);
    expect(out.errors).toEqual([]);
    expect(out.preservation?.compatible).toBe(true);
    expect(out.grounding?.ok).toBe(true);
    expect(out.turn?.reply).toMatch(/Meta de Alimentação: você usou R\$\s670,92 de R\$\s1\.000,00 \(67%\)/);
    expect(out.turn?.reply).not.toContain("Lazer");
  });

  it("continua fail-closed: filtro de categoria pedido e NÃO confirmado pela engine bloqueia", async () => {
    const out = await run("goal_progress", allGoals, [{ field: "category", op: "eq", value: "Alimentação" }]);
    expect(out.preservation?.compatible).toBe(false);
    expect(JSON.stringify(out.preservation?.mismatches)).toContain("filter_lost");
  });

  it("continua fail-closed: número que não está no resultado da engine é violação", () => {
    const requested = normalizeToV3(ir("balance") as never, { today: "2026-10-01" });
    const claims = buildEvidenceClaims(ir("balance") as never, {
      outcomes: [{ query_id: "q1", status: "ok", engine: "get_financial_snapshot", args: {}, result: snapshot }],
    } as never);
    expect(requested.queries[0].metric).toBe("balance");
    expect(groundReply({ reply: "Você tem R$ 12.345,67 disponíveis.", claims }).ok).toBe(true);
    const bad = groundReply({ reply: "Você tem R$ 99.999,99 disponíveis.", claims });
    expect(bad.ok).toBe(false);
    expect(bad.violations[0].detail).toBe("money_not_in_evidence");
  });
});

describe("executedIRFrom e mapeamento de capacidade", () => {
  const q = (metric: string) => normalizeToV3(ir(metric) as never, { today: "2026-10-01" }).queries[0];
  it("deriva o executado para cada métrica de estado e nunca para resultado vazio ou com erro", () => {
    for (const metric of ["balance", "net_worth", "debt_balance", "goal_progress", "future_installments", "financial_health"]) {
      expect(executedIRFrom(q(metric), { some: 1 })?.metric).toBe(metric);
      expect(executedIRFrom(q(metric), {})).toBeNull();
      expect(executedIRFrom(q(metric), { error: "x" })).toBeNull();
      expect(executedIRFrom(q(metric), null)).toBeNull();
    }
  });
  it("não inventa executado para métrica de gasto sem estrutura", () => {
    expect(executedIRFrom(q("expense_amount"), { kind: "financial_snapshot", total: 1 })).toBeNull();
  });
  it("meta com filtro de categoria agora é uma capacidade suportada", () => {
    const withCat = capabilityFromFinancialIR(ir("goal_progress", [{ field: "category", op: "eq", value: "Alimentação" }]) as never);
    expect(withCat.capability?.required_tool).toBe("get_goals_overview");
    expect(withCat.capability?.tool_args).toEqual({ category: "Alimentação" });
    const twoFilters = capabilityFromFinancialIR(ir("goal_progress", [
      { field: "category", op: "eq", value: "A" }, { field: "merchant", op: "eq", value: "B" },
    ]) as never);
    expect(twoFilters.capability).toBeNull();
    const balanceWithAccount = capabilityFromFinancialIR(ir("balance", [{ field: "account", op: "eq", value: "Itaú" }]) as never);
    expect(balanceWithAccount.capability?.required_tool).toBe("get_account_balance");
    expect(balanceWithAccount.capability?.tool_args).toEqual({ account: "Itaú" });
  });
  it("saldo por conta: executado confirma o filtro de conta; conta inexistente não prova nada", () => {
    const ok = executedIRFrom(q("balance"), { accounts: [{ name: "Itaú", balance: 10 }], account_filter: { requested: "Itaú", applied: true } });
    expect(ok?.filters).toEqual([{ field: "account", op: "eq", value: "Itaú" }]);
    const none = executedIRFrom(q("balance"), { accounts: [], account_filter: { requested: "XP", applied: false } });
    expect(none?.filters).toEqual([]);
  });
});

describe("formatGoalsOverview com categoria", () => {
  it("meta estourada diz quanto passou", () => {
    const text = formatGoalsOverview({
      category_filter: { requested: "Lazer", applied: true, matched: 1 },
      category_goals: [{ name: "Lazer", target: 500, achieved: 650, remaining: -150, used_pct: 130, over_limit: true }],
    });
    expect(text).toMatch(/passou do limite em R\$\s150,00/);
  });
  it("categoria sem meta responde com honestidade e oferece criar", () => {
    const text = formatGoalsOverview({ category_filter: { requested: "Viagem", applied: true, matched: 0 }, category_goals: [] });
    expect(text).toContain("Você ainda não tem uma meta de Viagem");
  });
});
