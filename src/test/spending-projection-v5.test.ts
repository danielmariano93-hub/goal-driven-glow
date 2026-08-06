import { describe, it, expect } from "vitest";
import { computeFinancialSnapshot } from "@/lib/engine/metrics";

type Tx = Record<string, unknown>;

function tx(over: Tx): Tx {
  return {
    id: Math.random().toString(36).slice(2),
    type: "expense",
    amount: 100,
    occurred_at: "2026-03-05",
    posted_at: "2026-03-05",
    status: "confirmed",
    account_id: "acc",
    category_id: null,
    description: "gasto",
    ...over,
  };
}

function snapshotOf(txs: Tx[], today: Date) {
  return computeFinancialSnapshot({
    accounts: [{ id: "acc", name: "Conta", type: "checking", opening_balance: 1000, active: true }] as never,
    txs: txs as never,
    recurring: [],
    snapshots: [] as never,
    investments: [],
    debts: [],
    categoryGoals: [],
    period: { start: "2026-03-01", end: "2026-03-31" },
    today,
  });
}

describe("financial_snapshot_contract.v5 — ritmo e projeção", () => {
  const today = new Date(2026, 2, 10); // 10/03/2026

  it("ritmo atual = consumo realizado do mês ÷ dias corridos, com dias sem gasto", () => {
    const snap = snapshotOf([tx({ amount: 300, occurred_at: "2026-03-02", posted_at: "2026-03-02" })], today);
    expect(snap.projection.daysElapsed).toBe(10);
    expect(snap.projection.realizedConsumption).toBe(300);
    expect(snap.projection.currentDailyPace).toBe(30);
  });

  it("gasto projetado e saldo projetado são números distintos", () => {
    const snap = snapshotOf([tx({ amount: 300, occurred_at: "2026-03-02", posted_at: "2026-03-02" })], today);
    expect(snap.projection.projectedTotalSpending).not.toBe(snap.projection.projectedEndBalance);
    expect(snap.projection.projectedTotalSpending).toBeGreaterThan(0);
  });

  it("gasto total esperado = realizado + variável + compromissos + fatura", () => {
    const snap = snapshotOf([tx({ amount: 210, occurred_at: "2026-03-01", posted_at: "2026-03-01" })], today);
    const p = snap.projection;
    expect(p.projectedTotalSpending).toBeCloseTo(
      p.realizedConsumption + p.projectedVariableSpending + p.upcomingConfirmedCommitments + p.cardDueThisMonth,
      2,
    );
  });

  it("leva uma fatura oficial com vencimento no mês para a agenda e a projeção", () => {
    const snap = computeFinancialSnapshot({
      accounts: [{ id: "acc", name: "Conta", type: "checking", opening_balance: 1000, active: true }] as never,
      txs: [], recurring: [], snapshots: [] as never, investments: [], debts: [], categoryGoals: [],
      period: { start: "2026-03-01", end: "2026-03-31" }, today,
      cardIds: ["card"], cards: [{ id: "card", name: "Nino", closing_day: 20, due_day: 30 }],
      cardStatements: [{ id: "st", credit_card_id: "card", competence_month: "2026-03-01", due_date: "2026-03-30", stated_total: 400, paid_amount: 0, outstanding_amount: 400, status: "open" }],
    });
    expect(snap.commitmentAgenda.items).toEqual(expect.arrayContaining([expect.objectContaining({ source: "card_statement", amount: 400, date: "2026-03-30" })]));
    expect(snap.projection.cardDueThisMonth).toBe(400);
    expect(snap.projection.projectedTotalSpending).toBeGreaterThanOrEqual(400);
  });

  it("saldo projetado fecha a equação declarada na UI", () => {
    const snap = snapshotOf([tx({ amount: 210, occurred_at: "2026-03-01", posted_at: "2026-03-01" })], today);
    const p = snap.projection;
    expect(p.projectedEndBalance).toBeCloseTo(
      p.currentAvailableBalance + p.confirmedFutureInflows - p.upcomingConfirmedCommitments
        - p.cardDueThisMonth - p.projectedVariableSpending,
      2,
    );
  });

  it("confiança é preliminar no início do mês e alta depois de 14 dias", () => {
    expect(snapshotOf([], new Date(2026, 2, 2)).projection.confidence).toBe("insufficient");
    expect(snapshotOf([], new Date(2026, 2, 5)).projection.confidence).toBe("low");
    expect(snapshotOf([], new Date(2026, 2, 10)).projection.confidence).toBe("medium");
    expect(snapshotOf([], new Date(2026, 2, 20)).projection.confidence).toBe("high");
  });

  it("transferência entre contas nunca entra no ritmo", () => {
    const snap = snapshotOf([tx({ type: "transfer", amount: 900, occurred_at: "2026-03-03", posted_at: "2026-03-03" })], today);
    expect(snap.projection.realizedConsumption).toBe(0);
    expect(snap.projection.currentDailyPace).toBe(0);
  });

  it("sem gasto algum, o mês projeta zero de gasto variável", () => {
    const snap = snapshotOf([], today);
    expect(snap.projection.projectedVariableSpending).toBe(0);
  });
});
