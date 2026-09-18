import { describe, expect, it } from "vitest";
import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import { normalizeToV3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import { executedIRFrom } from "../../supabase/functions/_shared/agent/core/ExecutedIRBridge";
import { requestedSubsumesExecuted } from "../../supabase/functions/_shared/agent/core/SemanticPreservation";
import { computeCompareToMonthlyAverage } from "../../supabase/functions/_shared/analytics/compare";
import {
  formatAverageComparison,
  formatMerchantDistribution,
} from "../../supabase/functions/_shared/agent/core/DeterministicAnswers";

const AUGUST = { from: "2026-08-01", to: "2026-08-31", label: "agosto" };
const JULY = { from: "2026-07-01", to: "2026-07-31", label: "julho" };

function baseTurn(): CanonicalConversationTurnContract {
  return {
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "read",
    domain: "financial_read",
    canonical_request: "Quais categorias de agosto ficaram acima da média dos últimos 3 meses?",
    inherit_focus: true,
    focus: {
      category: null,
      merchant: null,
      goal: null,
      period_expression: "agosto",
      period_expressions: ["agosto"],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "resolved",
      entity: "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "analyze",
      queries: [{
        metric: "expense_amount",
        operation: "compare",
        group_by: ["category"],
        filters: [],
        limit: null,
        comparison_direction: "increase",
        comparison_baseline: "mean_previous_complete_months",
        comparison_baseline_window: 3,
        comparison_baseline_expression: null,
        comparison_target_expression: "agosto",
      }],
    },
    advisory_kind: null,
  };
}

describe("regressão 17/09 — média histórica por categoria", () => {
  it("preserva média dos 3 meses anteriores como baseline semântico próprio", () => {
    const normalized = normalizeConversationTurnContract(baseTurn());
    const q = normalized?.financial_read?.queries[0];
    expect(q?.comparison_baseline).toBe("mean_previous_complete_months");
    expect(q?.comparison_baseline_window).toBe(3);
    expect(q?.comparison_direction).toBe("increase");
    expect(q?.comparison_target_expression).toBe("agosto");
  });

  it("não degrada média histórica para compare_periods", () => {
    const compiled = compileFinancialReadFromTurn({
      turn: baseTurn(),
      period: AUGUST,
      comparison_period: JULY,
    });
    expect(compiled?.ir?.queries[0]).toMatchObject({
      operation: "compare",
      comparison_baseline: "mean_previous_complete_months",
      comparison_baseline_window: 3,
      comparison_direction: "increase",
    });
    const capability = capabilityFromFinancialIR(compiled!.ir!);
    expect(capability.mapped_tools).toEqual(["compare_to_monthly_average"]);
    expect(capability.capability?.tool_args).toMatchObject({
      months: 3,
      target_period: AUGUST,
      comparison_direction: "increase",
      group_by: "category",
    });
  });

  it("calcula agosto contra maio-junho-julho, incluindo mês sem gasto como zero", () => {
    const tx = (id: string, date: string, amount: number, category_id: string) => ({
      id,
      occurred_at: date + "T12:00:00Z",
      amount,
      category_id,
      type: "expense",
      status: "confirmed",
      movement_kind: "transaction",
      transfer_group_id: null,
      settles_card_id: null,
    }) as any;
    const result = computeCompareToMonthlyAverage({
      txs: [
        tx("m1", "2026-05-10", 80, "lazer"),
        tx("m2", "2026-06-10", 100, "lazer"),
        tx("m3", "2026-07-10", 120, "lazer"),
        tx("m4", "2026-08-10", 160, "lazer"),
        tx("m5", "2026-07-12", 90, "saude"),
        tx("m6", "2026-08-12", 10, "saude"),
      ],
      categoryNames: new Map([["lazer", "Lazer"], ["saude", "Saúde"]]),
      metric: "expense",
      target_period: { from: AUGUST.from, to: AUGUST.to },
      months: 3,
      group_by: "category",
    });
    expect(result.baseline_periods).toEqual([
      { from: "2026-05-01", to: "2026-05-31" },
      { from: "2026-06-01", to: "2026-06-30" },
      { from: "2026-07-01", to: "2026-07-31" },
    ]);
    expect(result.by_group.find((row) => row.name === "Lazer")).toMatchObject({
      total_a: 100,
      total_b: 160,
      delta_abs: 60,
    });
    // Saúde teve R$90 só em julho: média correta = 30, não 90.
    expect(result.by_group.find((row) => row.name === "Saúde")).toMatchObject({
      total_a: 30,
      total_b: 10,
      delta_abs: -20,
    });
  });

  it("responde 'acima da média', não 'aumentaram' entre duas janelas", () => {
    const reply = formatAverageComparison({
      requested_comparison_direction: "increase",
      requested_limit: null,
      baseline_window_months: 3,
      target_label: "agosto",
      by_group: [
        { name: "Lazer", total_a: 100, total_b: 160, delta_abs: 60 },
        { name: "Saúde", total_a: 30, total_b: 10, delta_abs: -20 },
      ],
    });
    expect(reply).toContain("acima da média");
    expect(reply).toContain("Lazer");
    expect(reply).not.toContain("Saúde");
    expect(reply).not.toContain("Aumentaram:");
  });

  it("normaliza alvo multi-mês antes de comparar com média mensal", () => {
    const tx = (id: string, date: string, amount: number, category_id: string) => ({
      id, occurred_at: date + "T12:00:00Z", amount, category_id,
      type: "expense", status: "confirmed", movement_kind: "transaction",
      transfer_group_id: null, settles_card_id: null,
    }) as any;
    const result = computeCompareToMonthlyAverage({
      txs: [
        tx("b1", "2026-03-10", 142.64, "moradia"),
        tx("b2", "2026-04-10", 363.42, "moradia"),
        tx("t1", "2026-06-20", 3529.34, "moradia"),
        tx("t2", "2026-07-20", 8655.37, "moradia"),
        tx("t3", "2026-09-10", 3845.71, "moradia"),
      ],
      categoryNames: new Map([["moradia", "Moradia"]]),
      metric: "expense",
      target_period: { from: "2026-06-18", to: "2026-09-18" },
      months: 3,
      group_by: "category",
    });
    const moradia = result.by_group.find((row) => row.name === "Moradia");
    expect(result.target_window_months).toBe(3);
    expect(result.target_statistic).toBe("monthly_mean");
    expect(moradia?.total_a).toBe(168.69);
    expect(moradia?.total_b).toBe(5343.47);
    expect(moradia?.delta_abs).toBe(5174.79);
    expect(result.provenance.formula_version).toBe("compare.monthly_mean.v2");
  });

  it("responde diretamente a categoria singular do follow-up superlativo", () => {
    const reply = formatAverageComparison({
      requested_comparison_direction: "increase",
      requested_limit: 1,
      baseline_window_months: 3,
      target_label: "agosto",
      by_group: [
        { name: "Energia", total_a: 135.80, total_b: 507.05, delta_abs: 371.25 },
        { name: "Educação", total_a: 0, total_b: 806.40, delta_abs: 806.40 },
      ],
    });
    expect(reply).toContain("mais acima da média");
    expect(reply).toContain("Educação");
    expect(reply).toContain("806,40");
    expect(reply).not.toContain("Energia");
  });
});

describe("regressão 17/09 — estabelecimentos de Lazer em agosto", () => {
  it("mapeia breakdown por estabelecimento para merchant_distribution", () => {
    const turn = baseTurn();
    turn.canonical_request = "Quais foram os principais estabelecimentos da categoria Lazer em agosto?";
    turn.financial_read = {
      intent: "lookup",
      queries: [{
        metric: "expense_amount",
        operation: "breakdown",
        group_by: ["merchant"],
        filters: [{ field: "category", op: "eq", value: "Lazer" }],
        limit: null,
        comparison_direction: "any",
        comparison_baseline: "period",
        comparison_baseline_window: null,
        comparison_baseline_expression: null,
        comparison_target_expression: null,
      }],
    };
    const compiled = compileFinancialReadFromTurn({ turn, period: AUGUST, comparison_period: JULY });
    const capability = capabilityFromFinancialIR(compiled!.ir!);
    expect(capability.mapped_tools).toEqual(["merchant_distribution"]);
    expect(capability.capability?.name).toBe("merchant_distribution");
    expect(capability.capability?.tool_args).toMatchObject({
      from: AUGUST.from,
      to: AUGUST.to,
      category_name: "Lazer",
    });
  });

  it("merchant_distribution declara o IR executado e não é bloqueado pelo preservation gate", () => {
    const turn = baseTurn();
    turn.financial_read = {
      intent: "lookup",
      queries: [{
        metric: "expense_amount",
        operation: "breakdown",
        group_by: ["merchant"],
        filters: [{ field: "category", op: "eq", value: "Lazer" }],
        limit: null,
        comparison_direction: "any",
        comparison_baseline: "period",
        comparison_baseline_window: null,
        comparison_baseline_expression: null,
        comparison_target_expression: null,
      }],
    };
    const compiled = compileFinancialReadFromTurn({ turn, period: AUGUST, comparison_period: JULY })!;
    const requested = normalizeToV3(compiled.ir!, { today: "2026-09-17" }).queries[0];
    const result = {
      engine: "merchant_distribution",
      scope: "category",
      category: { name: "Lazer" },
      category_total: 300,
      resolved_total: 300,
      unresolved_total: 0,
      coverage: 1,
      period: { from: AUGUST.from, to: AUGUST.to },
      merchants: [
        { merchant: "Bar A", amount: 200, share_of_category: 2 / 3, transactions_count: 2 },
        { merchant: "Cinema B", amount: 100, share_of_category: 1 / 3, transactions_count: 1 },
      ],
    };
    const executed = executedIRFrom(requested, result);
    expect(executed).toMatchObject({
      metric: "expense_amount",
      filters: [{ field: "category", op: "eq", value: "Lazer" }],
      group_by: ["merchant"],
      time: { from: AUGUST.from, to: AUGUST.to },
    });
    expect(requestedSubsumesExecuted(requested, executed).compatible).toBe(true);
    const reply = formatMerchantDistribution(result);
    expect(reply).toContain("Lazer");
    expect(reply).toContain("Bar A");
    expect(reply).toContain("Cinema B");
  });
});
