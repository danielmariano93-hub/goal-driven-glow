import { describe, it, expect } from "vitest";
import { evaluateCategoryGoal, type CategorySpendingGoalRow } from "@/lib/engine/metrics";
import { buildStrategyForCategoryGoal } from "@/lib/goals/strategyInputs";
import type { TransactionRow } from "@/lib/engine/facts";

const TRANSPORTE = "cat-transporte";
const ASSINATURAS = "cat-assinaturas";

let seq = 0;
function tx(
  categoryId: string,
  occurred_at: string,
  amount: number,
  description: string,
  extra: Partial<TransactionRow> = {},
): TransactionRow {
  seq += 1;
  return {
    id: `tx-${seq}`,
    account_id: "acc-1",
    category_id: categoryId,
    type: "expense",
    status: "confirmed",
    amount,
    occurred_at,
    description,
    transfer_group_id: null,
    payment_method: "pix",
    credit_card_id: null,
    ...extra,
  } as TransactionRow;
}

function goal(overrides: Partial<CategorySpendingGoalRow> = {}): CategorySpendingGoalRow {
  return {
    id: "g1",
    user_id: "u1",
    category_id: TRANSPORTE,
    mode: "fixed_limit",
    reduction_pct: null,
    fixed_limit: 700,
    baseline_kind: "custom",
    baseline_value: 1000,
    computed_limit: 700,
    frequency: "monthly",
    start_date: "2026-08-01",
    end_date: "2026-08-31",
    status: "active",
    period_type: "this_month",
    ...overrides,
  } as CategorySpendingGoalRow;
}

describe("merchant distribution — mutuamente exclusiva", () => {
  const today = new Date("2026-08-18T12:00:00");

  it("CASO 1 + 2: Uber e variantes ON UBER TRIP viram uma única linha canônica", () => {
    const txs = [
      tx(TRANSPORTE, "2026-08-02", 100, "Uber"),
      tx(TRANSPORTE, "2026-08-04", 50, "ON UBER TRIP H01/08"),
      tx(TRANSPORTE, "2026-08-05", 20, "ON UBER TRIP H04/08"),
    ];
    const ev = evaluateCategoryGoal(goal(), txs, today, "Transporte");
    const strategy = buildStrategyForCategoryGoal(ev, txs as never);

    const uber = strategy.hotspots.filter((h) => /uber/i.test(h.label));
    expect(uber).toHaveLength(1);
    expect(uber[0].amount).toBeCloseTo(170, 2);
    expect(uber[0].sharePct).toBeCloseTo(100, 1);
    expect(strategy.hotspots.some((h) => /ON UBER TRIP/i.test(h.label))).toBe(false);
  });

  it("CASO 3: 99 e PAY 99 TE colapsam em um único merchant", () => {
    const txs = [
      tx(TRANSPORTE, "2026-08-03", 200, "99"),
      tx(TRANSPORTE, "2026-08-09", 67.18, "PAY 99 TE 09/08"),
    ];
    const ev = evaluateCategoryGoal(goal(), txs, today, "Transporte");
    const strategy = buildStrategyForCategoryGoal(ev, txs as never);
    const noventaNove = strategy.hotspots.filter((h) => /99/.test(h.label));
    expect(noventaNove).toHaveLength(1);
    expect(noventaNove[0].amount).toBeCloseTo(267.18, 2);
  });

  it("CASO 12: soma de merchants + Outros reconcilia com o gasto da categoria e nunca passa de 100%", () => {
    const txs = [
      tx(TRANSPORTE, "2026-08-02", 100, "Uber"),
      tx(TRANSPORTE, "2026-08-03", 90, "99"),
      tx(TRANSPORTE, "2026-08-04", 70.2, "Autopass"),
      tx(TRANSPORTE, "2026-08-05", 40, "Metro SP"),
      tx(TRANSPORTE, "2026-08-06", 25, "Estacionamento Centro"),
      tx(TRANSPORTE, "2026-08-07", 15, "Posto Ipiranga"),
    ];
    const ev = evaluateCategoryGoal(goal(), txs, today, "Transporte");
    const strategy = buildStrategyForCategoryGoal(ev, txs as never);

    const shown = strategy.hotspots.reduce((sum, h) => sum + h.amount, 0) + strategy.others.amount;
    const shares = strategy.hotspots.reduce((sum, h) => sum + h.sharePct, 0) + strategy.others.sharePct;
    expect(shown).toBeCloseTo(340.2, 2);
    expect(shares).toBeLessThanOrEqual(100.5);
    expect(strategy.others.amount).toBeGreaterThanOrEqual(0);
  });
});

describe("projeção por natureza da categoria", () => {
  const today = new Date("2026-08-18T12:00:00");
  const assinaturasGoal = goal({
    id: "g2",
    category_id: ASSINATURAS,
    computed_limit: 872.17,
    fixed_limit: 872.17,
  });

  /** Série mensal estável (Lovable) + uma cobrança ainda esperada no período. */
  function assinaturasTxs(): TransactionRow[] {
    return [
      // Histórico: 3 meses da mesma cobrança, dia 20
      tx(ASSINATURAS, "2026-05-20", 100, "Lovable"),
      tx(ASSINATURAS, "2026-06-20", 100, "Lovable"),
      tx(ASSINATURAS, "2026-07-20", 100, "Lovable"),
      // Período corrente: outra assinatura já cobrada
      tx(ASSINATURAS, "2026-06-10", 715.78, "Netflix Premium"),
      tx(ASSINATURAS, "2026-07-10", 715.78, "Netflix Premium"),
      tx(ASSINATURAS, "2026-08-10", 715.78, "Netflix Premium"),
    ];
  }

  it("CASO 4: assinaturas projetam confirmado + recorrência esperada, não run-rate diário", () => {
    const txs = assinaturasTxs();
    const ev = evaluateCategoryGoal(assinaturasGoal, txs, today, "Assinaturas");
    expect(ev.actualSpend).toBeCloseTo(715.78, 2);
    expect(ev.projectionMethod).toBe("commitment");
    expect(ev.remainingKnownCommitments).toBeCloseTo(100, 2);
    expect(ev.projectedFinalSpend).toBeCloseTo(815.78, 2);
    // Run-rate linear daria ~1.232 — não pode acontecer aqui.
    expect(ev.projectedFinalSpend).toBeLessThan(1000);
  });

  it("CASO 10 + 8/9: categoria de compromisso não usa R$/dia nem corte por dia", () => {
    const txs = assinaturasTxs();
    const ev = evaluateCategoryGoal(assinaturasGoal, txs, today, "Assinaturas");
    const strategy = buildStrategyForCategoryGoal(ev, txs as never);

    expect(ev.supportsDailyBudget).toBe(false);
    expect(strategy.allowsDailyBudget).toBe(false);
    expect(strategy.dailyAllowance).toBe(0);
    expect(strategy.requiredDailyCut).toBe(0);
    const allCopy = [strategy.headline, strategy.nextAction, ...strategy.steps.map((s) => `${s.title} ${s.detail}`)].join(" ");
    expect(allCopy).not.toMatch(/por dia/i);
  });

  /** Consumo contínuo: gasto na maioria dos dias do período. */
  function transporteTxs(daily = 20): TransactionRow[] {
    return Array.from({ length: 14 }, (_, i) =>
      tx(TRANSPORTE, `2026-08-${String(i + 2).padStart(2, "0")}`, daily, i % 2 === 0 ? "Uber" : "99"));
  }

  it("CASO 9: categoria diária (Transporte) mantém R$/dia", () => {
    const ev = evaluateCategoryGoal(goal(), transporteTxs(), today, "Transporte");
    expect(ev.projectionMethod).toBe("flow");
    expect(ev.supportsDailyBudget).toBe(true);
    expect(ev.dailyAllowance).toBeGreaterThan(0);
  });

  it("CASO 11: componentes da projeção reconciliam com o total projetado", () => {
    const txs = assinaturasTxs();
    const ev = evaluateCategoryGoal(assinaturasGoal, txs, today, "Assinaturas");
    const c = ev.projection.components;
    expect(c.confirmedSpend + c.remainingKnownCommitments + c.variableProjection).toBeCloseTo(c.projectedTotal, 2);
  });
});

describe("estados e copy da meta", () => {
  const today = new Date("2026-08-18T12:00:00");

  it("CASO 5: gasto abaixo do teto nunca fala de excesso atual", () => {
    const txs = [tx(ASSINATURAS, "2026-08-10", 715.78, "Netflix Premium")];
    const g = goal({ category_id: ASSINATURAS, computed_limit: 872.17, fixed_limit: 872.17 });
    const ev = evaluateCategoryGoal(g, txs, today, "Assinaturas");
    const strategy = buildStrategyForCategoryGoal(ev, txs as never);

    expect(strategy.currentOverage).toBe(0);
    expect(strategy.remainingAmount).toBeCloseTo(156.39, 2);
    const noNewCharges = strategy.scenarios.find((s) => s.id === "no_new_charges");
    expect(noNewCharges?.detail).not.toMatch(/excesso/i);
    expect(noNewCharges?.detail).toMatch(/abaixo do teto/i);
  });

  it("CASO 6: abaixo do teto mas com projeção acima → 'ainda dentro, mas em risco'", () => {
    const txs = [
      tx(TRANSPORTE, "2026-08-02", 200, "Uber"),
      tx(TRANSPORTE, "2026-08-06", 200, "99"),
      tx(TRANSPORTE, "2026-08-12", 200, "Autopass"),
    ];
    const ev = evaluateCategoryGoal(goal(), txs, today, "Transporte");
    const strategy = buildStrategyForCategoryGoal(ev, txs as never);

    expect(strategy.currentOverage).toBe(0);
    expect(strategy.projectedOverage).toBeGreaterThan(0);
    expect(strategy.state).toMatch(/under_budget_but_at_risk|low_confidence/);
    expect(strategy.headline).toMatch(/dentro do teto/i);
    expect(strategy.headline).toMatch(/projeção/i);
  });

  it("CASO 7: gasto acima do teto → 'teto ultrapassado' com excesso real", () => {
    const txs = [tx(TRANSPORTE, "2026-08-05", 1064.2, "Uber")];
    const ev = evaluateCategoryGoal(goal(), txs, today, "Transporte");
    const strategy = buildStrategyForCategoryGoal(ev, txs as never);

    expect(strategy.state).toBe("over_budget");
    expect(strategy.currentOverage).toBeCloseTo(364.2, 2);
    expect(strategy.headline).toMatch(/ultrapassado/i);
  });

  it("CASO 8: meta de redução não recebe recomendação automática de aumentar o teto", () => {
    const txs = [tx(TRANSPORTE, "2026-08-05", 1500, "Uber")];
    const g = goal({ mode: "percent_reduction", reduction_pct: 50, fixed_limit: null, computed_limit: 500 });
    const ev = evaluateCategoryGoal(g, txs, today, "Transporte");
    const strategy = buildStrategyForCategoryGoal(ev, txs as never);

    expect(strategy.scenarios.some((s) => s.id === "review_ceiling")).toBe(false);
    const keep = strategy.scenarios.find((s) => s.id === "keep_ceiling");
    expect(keep?.detail).toMatch(/redução/i);
  });

  it("todo cenário calculado carrega número ou efeito auditável", () => {
    const txs = [
      tx(TRANSPORTE, "2026-08-02", 200, "Uber"),
      tx(TRANSPORTE, "2026-08-06", 200, "99"),
    ];
    const ev = evaluateCategoryGoal(goal(), txs, today, "Transporte");
    const strategy = buildStrategyForCategoryGoal(ev, txs as never);
    expect(strategy.scenarios.length).toBeGreaterThan(0);
    for (const scenario of strategy.scenarios) {
      expect(scenario.projectedTotal !== null || scenario.effect !== null).toBe(true);
    }
  });

  it("projeção sempre declara método e confiança", () => {
    const ev = evaluateCategoryGoal(goal(), [], today, "Transporte");
    expect(["flow", "commitment", "hybrid", "insufficient_data"]).toContain(ev.projectionMethod);
    expect(["high", "medium", "low"]).toContain(ev.projectionConfidence);
  });
});
