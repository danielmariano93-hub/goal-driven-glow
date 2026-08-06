import { describe, expect, it } from "vitest";
import { computeFinancialSnapshot, FINANCE_CONTRACT_VERSION, SPENDING_PROJECTION_VERSION } from "@/lib/engine/metrics";

const emptyInput = {
  accounts: [], txs: [], recurring: [], snapshots: [], investments: [], debts: [], categoryGoals: [],
  period: { start: "2026-08-01", end: "2026-08-05" },
};

describe("contrato financeiro v6 da Home", () => {
  it("mantém snapshot e projeção na mesma versão", () => {
    expect(FINANCE_CONTRACT_VERSION).toBe("financial_snapshot_contract.v6");
    expect(SPENDING_PROJECTION_VERSION).toBe(FINANCE_CONTRACT_VERSION);
  });

  it("não libera projeção numérica antes de três dias observados", () => {
    const snapshot = computeFinancialSnapshot({ ...emptyInput, today: new Date(2026, 7, 2, 12) });
    expect(snapshot.projection.daysElapsed).toBe(2);
    expect(snapshot.projection.confidence).toBe("insufficient");
  });

  it("separa livre conhecido da estimativa variável", () => {
    const snapshot = computeFinancialSnapshot({ ...emptyInput, today: new Date(2026, 7, 5, 12) });
    expect(snapshot.projection.freeAfterKnownCommitments).toBe(
      snapshot.projection.currentAvailableBalance
      + snapshot.projection.confirmedFutureInflows
      - snapshot.projection.upcomingConfirmedCommitments
      - snapshot.projection.cardDueThisMonth,
    );
  });
});