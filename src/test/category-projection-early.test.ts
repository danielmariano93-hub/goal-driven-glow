import { describe, expect, it } from "vitest";
import { evaluateCategoryGoal, type CategorySpendingGoalRow } from "@/lib/engine/metrics";

// Caso real (3/11): Lazer com R$ 108 em 1 dia de 3, teto R$ 1.044,67 e histórico de R$ 1.100–2.000 por mês.
const goal = {
  id: "g1", user_id: "u1", category_id: "lazer", mode: "percent_reduction", reduction_pct: 30, fixed_limit: null, baseline_kind: "avg_3m",
  baseline_value: 1492.39, computed_limit: 1044.67, frequency: "monthly", start_date: "2026-11-01", end_date: "2026-11-30",
  status: "active", period_type: "this_month",
} as CategorySpendingGoalRow;
let n = 0;
const tx = (date: string, amount: number) => ({
  id: `t${++n}`, user_id: "u1", account_id: "a", category_id: "lazer", type: "expense", status: "confirmed", amount, occurred_at: date,
  description: "x", merchant_name: "x", transfer_group_id: null, movement_kind: "transaction", payment_method: "account",
}) as never;
const month = (ym: string, total: number) => [tx(`${ym}-05`, total / 2), tx(`${ym}-20`, total / 2)];
const history = [...month("2026-08", 1414), ...month("2026-09", 2028), ...month("2026-10", 1121)];
const avg = (1414 + 2028 + 1121) / 3;

describe("projeção nos primeiros dias do período (category_projection.v1)", () => {
  it("3 dias, 1 compra: projeta pelo histórico, não pelo gasto atual, e a frase não diz 'ritmo atual'", () => {
    const ev = evaluateCategoryGoal(goal, [...history, tx("2026-11-01", 108)], new Date("2026-11-03T12:00:00"), "Lazer");
    expect(ev.projection.basis).toBe("history");
    expect(ev.projection.historicalMonthlyAvg).toBeCloseTo(avg, 0);
    // 108 + média/30 × 27 dias
    expect(ev.projectedFinalSpend).toBeCloseTo(108 + (avg / 30) * 27, 0);
    expect(ev.projectedFinalSpend).toBeGreaterThan(ev.targetAmount); // o histórico passa do teto
    expect(ev.status).not.toBe("on_track");
    expect(ev.message).toMatch(/^Ainda é cedo \(3 dias\)\. Pelo seu histórico \(média de R\$ 1521,00 por mês\), você deve passar do teto em R\$ /);
    expect(ev.message).not.toMatch(/ritmo atual/);
    expect(ev.projection.confidence).toBe("low");
  });
  it("a frase também cobre quando o histórico cabe no teto", () => {
    const low = { ...goal, computed_limit: 2500 } as CategorySpendingGoalRow;
    const ev = evaluateCategoryGoal(low, [...history, tx("2026-11-01", 108)], new Date("2026-11-03T12:00:00"), "Lazer");
    expect(ev.status).toBe("on_track");
    expect(ev.message).toMatch(/^Ainda é cedo \(3 dias\)\. Pelo seu histórico .* você deve fechar perto de R\$ /);
  });
  it("a partir de 7 dias volta ao ritmo do período", () => {
    const ev = evaluateCategoryGoal(goal, [...history, tx("2026-11-01", 108), tx("2026-11-04", 80), tx("2026-11-06", 60), tx("2026-11-07", 50)], new Date("2026-11-08T12:00:00"), "Lazer");
    expect(ev.projection.basis).toBe("pace");
    expect(ev.projection.historicalMonthlyAvg).toBeNull();
  });
  it("sem histórico suficiente (menos de 2 meses fechados) não inventa: segue o método do período", () => {
    const ev = evaluateCategoryGoal(goal, [...month("2026-10", 1121), tx("2026-11-01", 108)], new Date("2026-11-03T12:00:00"), "Lazer");
    expect(ev.projection.basis).toBe("pace");
  });
  it("parcela antiga de cartão não entra na média histórica", () => {
    const carried = { ...tx("2026-10-12", 900), payment_method: "credit_card", credit_card_id: "cc1", installment_number: 2, installments_total: 3, purchase_group_id: "pg", purchase_date: "2026-08-12", competence_date: "2026-10-01" } as never;
    const first = { ...tx("2026-08-12", 900), payment_method: "credit_card", credit_card_id: "cc1", installment_number: 1, installments_total: 3, purchase_group_id: "pg", purchase_date: "2026-08-12", competence_date: "2026-08-01" } as never;
    const ev = evaluateCategoryGoal(goal, [...history, first, carried, tx("2026-11-01", 108)], new Date("2026-11-03T12:00:00"), "Lazer");
    // ago ganha a 1ª parcela (900), out NÃO ganha a 2ª (compromisso de compra anterior)
    expect(ev.projection.historicalMonthlyAvg).toBeCloseTo((1414 + 900 + 2028 + 1121) / 3, 0);
  });
});
