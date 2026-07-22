import { describe, it, expect } from "vitest";
import { evaluateCategoryGoal, resolveGoalPeriod, type CategorySpendingGoalRow } from "@/lib/engine/metrics";
import type { TransactionRow } from "@/lib/engine/facts";

const CAT = "cat-transporte";
const USER = "u1";

function tx(occurred_at: string, amount: number, extra: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: `tx-${occurred_at}-${amount}`,
    account_id: "acc-1",
    category_id: CAT,
    type: "expense",
    status: "confirmed",
    amount,
    occurred_at,
    description: "Uber",
    transfer_group_id: null,
    payment_method: "pix",
    credit_card_id: null,
    ...extra,
  } as TransactionRow;
}

function makeGoal(overrides: Partial<CategorySpendingGoalRow> = {}): CategorySpendingGoalRow {
  return {
    id: "g1",
    user_id: USER,
    category_id: CAT,
    mode: "percent_reduction",
    reduction_pct: 30,
    fixed_limit: null,
    baseline_kind: "custom",
    baseline_value: 1000,
    computed_limit: 700,
    frequency: "monthly",
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    status: "active",
    period_type: "this_month",
    ...overrides,
  };
}

describe("Metas de categoria — regressão do caso real (Transporte)", () => {
  const today = new Date("2026-07-22T12:00:00");

  it("considera todos os gastos de 01/07 a 31/07 mesmo com criação em 22/07", () => {
    const txs = [
      tx("2026-07-05", 500),
      tx("2026-07-14", 400),
      tx("2026-07-20", 142.60),
      tx("2026-07-22", 21.60), // dia da criação — deve entrar
      // Outros meses: NÃO entram
      tx("2026-06-30", 999),
      tx("2026-08-01", 999),
    ];
    const goal = makeGoal({ start_date: "2026-07-01", end_date: "2026-07-31", period_type: "this_month" });
    const ev = evaluateCategoryGoal(goal, txs, today, "Transporte");

    expect(ev.actualSpend).toBeCloseTo(1064.20, 2);
    expect(ev.status).toBe("exceeded");
    expect(ev.currentOverage).toBeCloseTo(364.20, 2);
    expect(ev.dailyAllowance).toBe(0);
    expect(ev.projectedFinalSpend).toBeGreaterThanOrEqual(ev.actualSpend);
    expect(ev.message).toMatch(/ultrapassou/i);
  });

  it("nunca classifica como 'on_track' uma meta cujo gasto já ultrapassou o limite", () => {
    const txs = [tx("2026-07-10", 1500)];
    const goal = makeGoal();
    const ev = evaluateCategoryGoal(goal, txs, today, "Transporte");
    expect(ev.status).toBe("exceeded");
    expect(ev.status).not.toBe("on_track");
  });

  it("meta 'this_month' criada no meio do mês inclui gastos retroativos", () => {
    const goal = makeGoal({ period_type: "this_month" });
    const period = resolveGoalPeriod(goal, today);
    expect(period.start).toBe("2026-07-01");
    expect(period.end).toBe("2026-07-31");
  });

  it("meta futura fica com status 'scheduled'", () => {
    const goal = makeGoal({ start_date: "2026-09-01", end_date: "2026-09-30", period_type: "custom" });
    const ev = evaluateCategoryGoal(goal, [], today, "Transporte");
    expect(ev.status).toBe("scheduled");
  });

  it("meta encerrada abaixo do limite → completed_ok", () => {
    const past = new Date("2026-08-15T12:00:00");
    const goal = makeGoal({ start_date: "2026-07-01", end_date: "2026-07-31", period_type: "custom" });
    const ev = evaluateCategoryGoal(goal, [tx("2026-07-10", 300)], past, "Transporte");
    expect(ev.status).toBe("completed_ok");
  });

  it("meta pausada retorna status paused", () => {
    const goal = makeGoal({ status: "paused" });
    const ev = evaluateCategoryGoal(goal, [tx("2026-07-05", 500)], today, "Transporte");
    expect(ev.status).toBe("paused");
  });

  it("dailyAllowance = 0 assim que actualSpend >= targetAmount", () => {
    const goal = makeGoal();
    const ev = evaluateCategoryGoal(goal, [tx("2026-07-05", 800)], today, "Transporte");
    expect(ev.actualSpend).toBeGreaterThan(ev.targetAmount);
    expect(ev.dailyAllowance).toBe(0);
  });

  it("projectedFinalSpend nunca é menor que actualSpend", () => {
    const goal = makeGoal();
    const ev = evaluateCategoryGoal(goal, [tx("2026-07-15", 900)], today, "Transporte");
    expect(ev.projectedFinalSpend).toBeGreaterThanOrEqual(ev.actualSpend);
  });

  it("filtra por category_id — despesa de outra categoria não conta", () => {
    const goal = makeGoal();
    const ev = evaluateCategoryGoal(
      goal,
      [tx("2026-07-10", 500, { category_id: "outra-cat" })],
      today,
      "Transporte",
    );
    expect(ev.actualSpend).toBe(0);
    expect(ev.status).toBe("on_track");
  });
});
