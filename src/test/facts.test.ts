import { describe, it, expect } from "vitest";
import {
  computeAccountBalances,
  computeMonthlyIncomeExpense,
  computeGoalProgress,
  computeNetWorth,
  computeBeforeSpending,
  computeCategoryBreakdown,
  round2,
  type AccountRow,
  type TransactionRow,
  type GoalRow,
  type GoalContributionRow,
  type InvestmentRow,
  type DebtRow,
} from "@/lib/engine/facts";

const acc = (id: string, opening = 0): AccountRow => ({ id, name: id, type: "checking", opening_balance: opening, active: true });
const tx = (over: Partial<TransactionRow> & Pick<TransactionRow, "id" | "account_id" | "type" | "amount" | "occurred_at">): TransactionRow => ({
  category_id: null,
  status: "confirmed",
  description: null,
  transfer_group_id: null,
  ...over,
});

describe("facts.round2", () => {
  it("rounds correctly", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBeCloseTo(1.01, 2);
  });
});

describe("computeAccountBalances", () => {
  it("adds income, subtracts expense, ignores transfers via legs", () => {
    const accounts = [acc("a", 100), acc("b", 0)];
    const txs: TransactionRow[] = [
      tx({ id: "1", account_id: "a", type: "income", amount: 50, occurred_at: "2026-01-01" }),
      tx({ id: "2", account_id: "a", type: "expense", amount: 20, occurred_at: "2026-01-02" }),
      // transfer: a -> b, 30
      tx({ id: "3", account_id: "a", type: "transfer", amount: 30, occurred_at: "2026-01-03", transfer_group_id: "g1" }),
      tx({ id: "4", account_id: "b", type: "transfer", amount: 30, occurred_at: "2026-01-03", transfer_group_id: "g1" }),
    ];
    const b = computeAccountBalances(accounts, txs);
    expect(b.a).toBe(100);
    expect(b.b).toBe(30);
  });

  it("transfers never appear in income/expense monthly totals", () => {
    const txs: TransactionRow[] = [
      tx({ id: "1", account_id: "a", type: "income", amount: 100, occurred_at: "2026-02-01" }),
      tx({ id: "2", account_id: "a", type: "transfer", amount: 50, occurred_at: "2026-02-02", transfer_group_id: "g" }),
      tx({ id: "3", account_id: "b", type: "transfer", amount: 50, occurred_at: "2026-02-02", transfer_group_id: "g" }),
      tx({ id: "4", account_id: "a", type: "expense", amount: 20, occurred_at: "2026-02-05" }),
    ];
    const m = computeMonthlyIncomeExpense(txs, "2026-02");
    expect(m.income).toBe(100);
    expect(m.expense).toBe(20);
    expect(m.net).toBe(80);
  });

  it("ignores planned transactions", () => {
    const txs: TransactionRow[] = [
      tx({ id: "1", account_id: "a", type: "income", amount: 100, occurred_at: "2026-03-01", status: "planned" }),
    ];
    const m = computeMonthlyIncomeExpense(txs, "2026-03");
    expect(m.income).toBe(0);
  });
});

describe("computeGoalProgress", () => {
  it("sums only own contributions", () => {
    const g: GoalRow = { id: "g1", name: "Viagem", target_amount: 1000, target_date: null, status: "active" };
    const contribs: GoalContributionRow[] = [
      { goal_id: "g1", amount: 100, occurred_at: "2026-01-01" },
      { goal_id: "g1", amount: 250.5, occurred_at: "2026-02-01" },
      { goal_id: "other", amount: 999, occurred_at: "2026-02-01" },
    ];
    const p = computeGoalProgress(g, contribs);
    expect(p.contributed).toBe(350.5);
    expect(p.remaining).toBe(649.5);
    expect(p.pct).toBeCloseTo(0.3505);
  });
});

describe("computeNetWorth", () => {
  it("adds cash + investments and subtracts active debts", () => {
    const accounts = [acc("a", 500)];
    const txs: TransactionRow[] = [];
    const inv: InvestmentRow[] = [{ id: "i1", name: "CDB", invested_amount: 200, current_value: 220, goal_id: null }];
    const debts: DebtRow[] = [
      { id: "d1", name: "Cartão", outstanding_balance: 100, original_amount: 300, status: "active" },
      { id: "d2", name: "Quitada", outstanding_balance: 0, original_amount: 100, status: "settled" },
    ];
    const nw = computeNetWorth(accounts, txs, inv, debts);
    expect(nw.cash).toBe(500);
    expect(nw.invested).toBe(220);
    expect(nw.owed).toBe(100);
    expect(nw.net).toBe(620);
  });
});

describe("computeCategoryBreakdown", () => {
  it("groups expenses by category and returns shares", () => {
    const txs: TransactionRow[] = [
      tx({ id: "1", account_id: "a", type: "expense", amount: 30, occurred_at: "2026-04-01", category_id: "c1" }),
      tx({ id: "2", account_id: "a", type: "expense", amount: 70, occurred_at: "2026-04-02", category_id: "c2" }),
      tx({ id: "3", account_id: "a", type: "income", amount: 999, occurred_at: "2026-04-02", category_id: "c1" }),
    ];
    const b = computeCategoryBreakdown(txs, [{ id: "c1", name: "A", type: "expense" }, { id: "c2", name: "B", type: "expense" }], "2026-04");
    expect(b[0].name).toBe("B");
    expect(b[0].share).toBeCloseTo(0.7);
    expect(b.reduce((a, x) => a + x.amount, 0)).toBe(100);
  });
});

describe("computeBeforeSpending", () => {
  it("returns availableAfter and assumptions without judging", () => {
    const accounts = [acc("a", 300)];
    const txs: TransactionRow[] = [];
    const r = computeBeforeSpending({
      amount: 100,
      accountId: "a",
      accounts,
      txs,
      recurring: [],
      debts: [],
      goals: [],
      contributions: [],
    });
    expect(r.availableAfter).toBe(200);
    expect(r.accountBalance).toBe(300);
    expect(r.assumptions.length).toBeGreaterThan(0);
  });

  it("flags goals at risk", () => {
    const accounts = [acc("a", 100)];
    const goals: GoalRow[] = [{ id: "g", name: "Emergência", target_amount: 5000, target_date: null, status: "active" }];
    const r = computeBeforeSpending({
      amount: 50,
      accountId: "a",
      accounts,
      txs: [],
      recurring: [],
      debts: [],
      goals,
      contributions: [],
    });
    expect(r.goalsAtRisk.length).toBe(1);
  });
});
