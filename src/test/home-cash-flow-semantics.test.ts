import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CashBridge } from "@/lib/engine/bridges";
import { summarizeCashFlow } from "@/lib/finance/cashFlowSummary";

const summaryCard = readFileSync("src/components/home/ResumoPeriodoCard.tsx", "utf8");
const homePage = readFileSync("src/pages/Index.tsx", "utf8");

function bridge(overrides: Partial<CashBridge> = {}): CashBridge {
  return {
    formulaVersion: "cash_bridge.v1",
    period: { start: "2026-09-01", end: "2026-09-20" },
    accountId: null,
    openingCash: 0,
    operationalIncome: 0,
    operationalAccountExpense: 0,
    investmentRedemptions: 0,
    investmentApplications: 0,
    externalTransfersIn: 0,
    externalTransfersOut: 0,
    internalTransfersNet: 0,
    loanProceeds: 0,
    debtPrincipalPayments: 0,
    debtInterestAndFees: 0,
    cardPayments: 0,
    refundsAndReimbursements: 0,
    investmentYieldCash: 0,
    adjustments: 0,
    unexplainedDifference: 0,
    calculatedClosingCash: 0,
    confirmedClosingCash: 0,
    reconciliationDifference: 0,
    confidence: "high",
    lines: [],
    evidence: {
      transactionCount: 0,
      inferredCashDateCount: 0,
      snapshotAnchorsInPeriod: 0,
      lastConfirmedSnapshot: null,
    },
    ...overrides,
  };
}

describe("Home — fluxo de caixa real", () => {
  it("reproduz o caso de transferência recebida sem transformar PIX em renda", () => {
    const cash = summarizeCashFlow(bridge({
      openingCash: 629.52,
      operationalIncome: 0,
      operationalAccountExpense: 1322.46,
      refundsAndReimbursements: 24.93,
      externalTransfersIn: 5029,
      externalTransfersOut: 2681,
      cardPayments: 167.81,
      calculatedClosingCash: 1512.18,
      confirmedClosingCash: 1512.18,
      reconciliationDifference: 0,
    }));

    expect(cash.inflow).toBe(5053.93);
    expect(cash.outflow).toBe(4171.27);
    expect(cash.netFlow).toBe(882.66);
    expect(629.52 + cash.netFlow).toBeCloseTo(1512.18, 2);
    expect(cash.reconciled).toBe(true);
  });

  it("inclui movimentos patrimoniais no caixa sem confundi-los com resultado da rotina", () => {
    const cash = summarizeCashFlow(bridge({
      operationalIncome: 1000,
      operationalAccountExpense: 300,
      investmentRedemptions: 500,
      investmentApplications: 250,
      investmentYieldCash: 20,
      externalTransfersIn: 700,
      externalTransfersOut: 100,
      loanProceeds: 400,
      debtPrincipalPayments: 80,
      debtInterestAndFees: 10,
      cardPayments: 200,
      refundsAndReimbursements: 30,
    }));

    expect(cash.inflow).toBe(2650);
    expect(cash.outflow).toBe(940);
    expect(cash.netFlow).toBe(1710);
  });

  it("não inventa diferença de conciliação como entrada ou saída", () => {
    const cash = summarizeCashFlow(bridge({
      externalTransfersIn: 100,
      operationalAccountExpense: 40,
      reconciliationDifference: 25,
      unexplainedDifference: 25,
    }));

    expect(cash.inflow).toBe(100);
    expect(cash.outflow).toBe(40);
    expect(cash.netFlow).toBe(60);
    expect(cash.reconciled).toBe(false);
    expect(cash.reconciliationDifference).toBe(25);
  });

  it("impede a Home de voltar a alimentar 'Entrou/Saiu' com PeriodPerformance", () => {
    expect(summaryCard).toContain("summarizeCashFlow");
    expect(summaryCard).toContain("cashBridge: CashBridge | null");
    expect(summaryCard).not.toContain("PeriodPerformance");
    expect(summaryCard).not.toContain("operationalIncome");
    expect(summaryCard).not.toContain("operationalExpense");
    expect(summaryCard).not.toContain("operationalResult");
    expect(homePage).toContain("cashBridge={snap?.cashBridge ?? null}");
    expect(homePage).not.toContain("performance={snap?.periodPerformance ?? null}");
  });
});
