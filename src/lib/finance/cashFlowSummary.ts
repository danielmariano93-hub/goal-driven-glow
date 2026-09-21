import type { CashBridge } from "@/lib/engine/bridges";
import { round2 } from "@/lib/engine/facts";

export interface CashFlowSummary {
  /** Tudo que efetivamente entrou em conta no período, independentemente de ser renda. */
  inflow: number;
  /** Tudo que efetivamente saiu da conta no período, independentemente de ser gasto da rotina. */
  outflow: number;
  /** Entradas de caixa menos saídas de caixa identificadas. */
  netFlow: number;
  /** Diferença entre movimentos identificados e o saldo bancário confirmado. */
  reconciliationDifference: number;
  reconciled: boolean;
}

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Resumo de CAIXA, não de renda/consumo.
 *
 * `PeriodPerformance` responde "como foi a rotina?" e exclui transferências,
 * aplicações, resgates, empréstimos e pagamentos de fatura por desenho.
 * Este resumo responde "quanto dinheiro entrou/saiu da conta?" usando apenas
 * linhas com impacto de caixa já classificadas pela `CashBridge` canônica.
 *
 * `unexplainedDifference`/`reconciliationDifference` nunca é inventado como
 * entrada ou saída: quando existe, permanece explícito como diferença pendente.
 */
export function summarizeCashFlow(bridge: CashBridge | null | undefined): CashFlowSummary {
  if (!bridge) {
    return {
      inflow: 0,
      outflow: 0,
      netFlow: 0,
      reconciliationDifference: 0,
      reconciled: true,
    };
  }

  const internalNet = amount(bridge.internalTransfersNet);
  const adjustment = amount(bridge.adjustments);

  const inflow = round2(
    amount(bridge.operationalIncome)
      + amount(bridge.refundsAndReimbursements)
      + amount(bridge.investmentRedemptions)
      + amount(bridge.investmentYieldCash)
      + amount(bridge.externalTransfersIn)
      + amount(bridge.loanProceeds)
      + Math.max(0, internalNet)
      + Math.max(0, adjustment),
  );

  const outflow = round2(
    amount(bridge.operationalAccountExpense)
      + amount(bridge.investmentApplications)
      + amount(bridge.externalTransfersOut)
      + amount(bridge.cardPayments)
      + amount(bridge.debtPrincipalPayments)
      + amount(bridge.debtInterestAndFees)
      + Math.max(0, -internalNet)
      + Math.max(0, -adjustment),
  );

  const reconciliationDifference = round2(amount(bridge.reconciliationDifference));

  return {
    inflow,
    outflow,
    netFlow: round2(inflow - outflow),
    reconciliationDifference,
    reconciled: Math.abs(reconciliationDifference) <= 0.01,
  };
}
