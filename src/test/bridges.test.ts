import { describe, it, expect } from "vitest";
import {
  MOVEMENT_SEMANTICS,
  computeCashBridge,
  computeNetWorthBridge,
  computePeriodPerformance,
  explainBalanceChange,
  semanticsOf,
} from "@/lib/engine/bridges";
import type { AccountRow, TransactionRow } from "@/lib/engine/facts";

const acc = (id: string, opening = 0): AccountRow => ({
  id, name: id, type: "checking", opening_balance: opening, active: true,
});

const tx = (
  over: Partial<TransactionRow> & Pick<TransactionRow, "id" | "account_id" | "type" | "amount" | "occurred_at">,
): TransactionRow => ({
  category_id: null,
  status: "confirmed",
  description: null,
  transfer_group_id: null,
  payment_method: "account",
  ...over,
});

const PERIOD = { start: "2026-08-01", end: "2026-08-31" };

describe("MOVEMENT_SEMANTICS — semântica por natureza", () => {
  it("resgate nunca é receita e aplicação nunca é gasto", () => {
    expect(MOVEMENT_SEMANTICS.investment_redemption.performanceImpact).toBe(0);
    expect(MOVEMENT_SEMANTICS.investment_application.performanceImpact).toBe(0);
    expect(MOVEMENT_SEMANTICS.investment_redemption.netWorthImpact).toBe(0);
    expect(MOVEMENT_SEMANTICS.investment_application.netWorthImpact).toBe(0);
  });

  it("compra no cartão não reduz caixa, mas aumenta obrigação e consumo", () => {
    const s = MOVEMENT_SEMANTICS.card_expense;
    expect(s.cashImpact).toBe(0);
    expect(s.debtImpact).toBe(1);
    expect(s.performanceImpact).toBe(-1);
  });

  it("pagamento de fatura reduz caixa e obrigação sem criar consumo", () => {
    const s = MOVEMENT_SEMANTICS.card_payment;
    expect(s.cashImpact).toBe(-1);
    expect(s.debtImpact).toBe(-1);
    expect(s.performanceImpact).toBe(0);
  });

  it("crédito de empréstimo não é receita", () => {
    expect(MOVEMENT_SEMANTICS.loan_proceeds.performanceImpact).toBe(0);
    expect(MOVEMENT_SEMANTICS.loan_proceeds.debtImpact).toBe(1);
    expect(MOVEMENT_SEMANTICS.loan_proceeds.netWorthImpact).toBe(0);
  });

  it("amortização não é consumo novo; juros e tarifas são custo", () => {
    expect(MOVEMENT_SEMANTICS.debt_payment.performanceImpact).toBe(0);
    expect(MOVEMENT_SEMANTICS.interest.performanceImpact).toBe(-1);
    expect(MOVEMENT_SEMANTICS.fee.performanceImpact).toBe(-1);
  });

  it("transferência interna é neutra em tudo", () => {
    const s = MOVEMENT_SEMANTICS.internal_transfer;
    expect([s.cashImpact, s.performanceImpact, s.netWorthImpact, s.debtImpact]).toEqual([0, 0, 0, 0]);
  });

  it("toda natureza declara os cinco impactos e uma linha de ponte", () => {
    for (const [key, s] of Object.entries(MOVEMENT_SEMANTICS)) {
      expect(typeof s.bridgeLine, key).toBe("string");
      expect([-1, 0, 1], key).toContain(s.cashImpact);
      expect([-1, 0, 1], key).toContain(s.performanceImpact);
      expect([-1, 0, 1], key).toContain(s.investmentImpact);
      expect([-1, 0, 1], key).toContain(s.debtImpact);
      expect([-1, 0, 1], key).toContain(s.netWorthImpact);
      expect(s.label.length, key).toBeGreaterThan(0);
    }
  });
});

describe("semanticsOf — precedência", () => {
  it("settles_card_id vence movement_kind e tipo", () => {
    const s = semanticsOf(tx({ id: "1", account_id: "a", type: "expense", amount: 100, occurred_at: "2026-08-10", settles_card_id: "c1" }));
    expect(s).toBe(MOVEMENT_SEMANTICS.card_payment);
  });

  it("despesa no cartão sem movement_kind vira card_expense", () => {
    const s = semanticsOf({ type: "expense", movement_kind: null, settles_card_id: null, payment_method: "credit_card", credit_card_id: "c1" });
    expect(s).toBe(MOVEMENT_SEMANTICS.card_expense);
  });
});

describe("computeCashBridge — a equação fecha", () => {
  const accounts = [acc("a", 5000)];
  const txs: TransactionRow[] = [
    tx({ id: "1", account_id: "a", type: "income", amount: 11000, occurred_at: "2026-08-05" }),
    tx({ id: "2", account_id: "a", type: "expense", amount: 15000, occurred_at: "2026-08-10" }),
    tx({ id: "3", account_id: "a", type: "income", amount: 1000, occurred_at: "2026-08-12", movement_kind: "investment_redemption" }),
  ];

  it("saldo inicial + movimentos = saldo final", () => {
    const b = computeCashBridge({ accounts, txs, period: PERIOD });
    expect(b.openingCash).toBe(5000);
    expect(b.operationalIncome).toBe(11000);
    expect(b.operationalAccountExpense).toBe(15000);
    expect(b.investmentRedemptions).toBe(1000);
    expect(b.confirmedClosingCash).toBe(2000);
    expect(b.calculatedClosingCash).toBe(2000);
    expect(Math.abs(b.reconciliationDifference)).toBeLessThanOrEqual(0.01);
    expect(b.adjustments).toBe(0);
    expect(b.confidence).toBe("high");
  });

  it("resgate não aparece como receita da rotina", () => {
    const perf = computePeriodPerformance(txs, PERIOD);
    expect(perf.operationalIncome).toBe(11000);
    expect(perf.operationalExpense).toBe(15000);
    expect(perf.operationalGap).toBe(4000);
    expect(perf.savingsRate).toBeCloseTo(-0.36, 2);
  });

  it("compra no cartão não entra na ponte de caixa", () => {
    const withCard = [
      ...txs,
      tx({ id: "4", account_id: "a", type: "expense", amount: 900, occurred_at: "2026-08-15", payment_method: "credit_card", credit_card_id: "c1" }),
    ];
    const b = computeCashBridge({ accounts, txs: withCard, period: PERIOD });
    expect(b.operationalAccountExpense).toBe(15000);
    expect(b.confirmedClosingCash).toBe(2000);
  });

  it("pagamento de fatura entra em card_payments e não em gastos", () => {
    const withPay = [
      ...txs,
      tx({ id: "5", account_id: "a", type: "expense", amount: 500, occurred_at: "2026-08-20", settles_card_id: "c1" }),
    ];
    const b = computeCashBridge({ accounts, txs: withPay, period: PERIOD });
    expect(b.cardPayments).toBe(500);
    expect(b.operationalAccountExpense).toBe(15000);
    expect(b.calculatedClosingCash).toBe(1500);
    expect(b.confirmedClosingCash).toBe(1500);
  });

  it("empréstimo creditado entra em loan_proceeds, não em receitas", () => {
    const withLoan = [
      ...txs,
      tx({ id: "6", account_id: "a", type: "income", amount: 3000, occurred_at: "2026-08-22", movement_kind: "loan_proceeds" }),
    ];
    const b = computeCashBridge({ accounts, txs: withLoan, period: PERIOD });
    expect(b.loanProceeds).toBe(3000);
    expect(b.operationalIncome).toBe(11000);
    expect(computePeriodPerformance(withLoan, PERIOD).operationalIncome).toBe(11000);
  });

  it("usa a data bancária (posted_at) para o windowing de caixa", () => {
    const straddling = [
      tx({ id: "7", account_id: "a", type: "expense", amount: 200, occurred_at: "2026-07-31", posted_at: "2026-08-01" }),
    ];
    const b = computeCashBridge({ accounts: [acc("a", 1000)], txs: straddling, period: PERIOD });
    expect(b.operationalAccountExpense).toBe(200);
    expect(b.openingCash).toBe(1000);
    expect(b.confirmedClosingCash).toBe(800);
  });

  it("snapshot confirmado dentro do período expõe diferença NÃO explicada (nunca como ajuste)", () => {
    const b = computeCashBridge({
      accounts,
      txs,
      snapshots: [{ account_id: "a", balance_date: "2026-08-15", balance: 900, status: "confirmed" }],
      period: PERIOD,
    });
    expect(b.evidence.snapshotAnchorsInPeriod).toBe(1);
    // lançamentos não explicam o saldo confirmado: a diferença fica visível
    expect(b.adjustments).toBe(0);
    expect(Math.abs(b.unexplainedDifference)).toBeGreaterThan(0.01);
    expect(b.reconciliationDifference).toBe(b.unexplainedDifference);
    expect(round2(b.calculatedClosingCash + b.unexplainedDifference)).toBe(b.confirmedClosingCash);
    expect(b.confidence).not.toBe("high");
  });
});

describe("computeNetWorthBridge", () => {
  it("patrimônio inicial + variações = patrimônio final", () => {
    const accounts = [acc("a", 5000)];
    const txs: TransactionRow[] = [
      tx({ id: "1", account_id: "a", type: "income", amount: 4000, occurred_at: "2026-08-02" }),
      tx({ id: "2", account_id: "a", type: "expense", amount: 1500, occurred_at: "2026-08-05" }),
      tx({ id: "3", account_id: "a", type: "expense", amount: 1000, occurred_at: "2026-08-06", movement_kind: "investment_application" }),
    ];
    const nw = computeNetWorthBridge({
      accounts, txs, period: PERIOD,
      investments: [{ id: "i1", name: "CDB", invested_amount: 1000, current_value: 1050, goal_id: null }],
      debts: [],
      investmentMovements: [
        { type: "application", amount: 1000, occurred_at: "2026-08-06" },
        { type: "yield", amount: 50, occurred_at: "2026-08-30" },
      ],
    });
    expect(nw.closingCash).toBe(6500);
    expect(nw.openingInvestments).toBe(0);
    expect(nw.closingInvestments).toBe(1050);
    expect(nw.investmentReturn).toBe(50);
    const recomposed =
      nw.openingNetWorth + nw.operationalResult + nw.investmentReturn - nw.interestAndFees
      - nw.debtPrincipalChange + nw.valuationAdjustments;
    expect(recomposed).toBeCloseTo(nw.closingNetWorth, 2);
  });
});

describe("explainBalanceChange", () => {
  it("nunca expõe resultado negativo isolado e contextualiza saldo positivo", () => {
    const accounts = [acc("a", 5000)];
    const txs: TransactionRow[] = [
      tx({ id: "1", account_id: "a", type: "income", amount: 11000, occurred_at: "2026-08-05" }),
      tx({ id: "2", account_id: "a", type: "expense", amount: 15000, occurred_at: "2026-08-10" }),
      tx({ id: "3", account_id: "a", type: "income", amount: 1000, occurred_at: "2026-08-12", movement_kind: "investment_redemption" }),
    ];
    const bridge = computeCashBridge({ accounts, txs, period: PERIOD });
    const perf = computePeriodPerformance(txs, PERIOD);
    const e = explainBalanceChange(bridge, perf);
    expect(e.headline).toContain("Gastos acima das receitas");
    expect(e.headline).not.toMatch(/Resultado: -/);
    expect(e.body).toContain("resgatou".length ? "Resgatou" : "");
    expect(e.body).toContain("Sua conta continua positiva");
    expect(e.tone).toBe("attention");
  });
});
