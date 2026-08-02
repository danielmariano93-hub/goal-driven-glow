import { describe, expect, it } from "vitest";
import { deterministicCandidates } from "../../supabase/functions/_shared/insights/detectors";
import { FINANCE_CONTRACT_VERSION } from "@/lib/engine/metrics";
import {
  computeActiveDebtsTotal,
  computeGoalProgressFacts,
  computeInvestedPrincipal,
  computeInvestmentsTotal,
} from "@/lib/engine/facts";

describe("finance_contract.v2", () => {
  it("expõe a versão v2 do contrato", () => {
    expect(FINANCE_CONTRACT_VERSION).toBe("finance_contract.v2");
  });

  it("progresso de meta soma contribuições e investimentos vinculados", () => {
    const p = computeGoalProgressFacts(
      1000,
      "g1",
      [{ goal_id: "g1", amount: 300 }, { goal_id: "g2", amount: 900 }],
      [{ goal_id: "g1", current_value: 200 }, { goal_id: null, current_value: 5000 }],
    );
    expect(p.contributed).toBe(300);
    expect(p.investedLinked).toBe(200);
    expect(p.total).toBe(500);
    expect(p.remaining).toBe(500);
    expect(p.pct).toBeCloseTo(0.5);
  });

  it("totais de investimento e dívidas ativas usam o core", () => {
    const invs = [
      { goal_id: null, current_value: 150, invested_amount: 100 },
      { goal_id: "g1", current_value: 50, invested_amount: 40 },
    ] as never;
    expect(computeInvestmentsTotal(invs)).toBe(200);
    expect(computeInvestedPrincipal(invs)).toBe(140);
    expect(
      computeActiveDebtsTotal([
        { status: "active", outstanding_balance: 100 },
        { status: "settled", outstanding_balance: 900 },
      ]),
    ).toBe(100);
  });
});

describe("insights_catalog.v1 — detectores determinísticos", () => {
  const base = {
    cardDebtToday: 0,
    cardFutureInstallments: 0,
    cardDebtIsEstimated: false,
    statementsDueIn7d: [],
    activeDebtTotal: 0,
    expenseMonth: 0,
    incomeMonth: 0,
    upcomingCommitments7d: 0,
  };

  it("não gera nada sem evidência", () => {
    expect(deterministicCandidates(base)).toEqual([]);
  });

  it("detecta fatura vencendo em 7 dias com valor e rota corretos", () => {
    const [tip] = deterministicCandidates({
      ...base,
      statementsDueIn7d: [{ cardId: "c1", dueDate: "2026-08-05", amount: 1200 }],
    });
    expect(tip.detector).toBe("card_statement_due_7d");
    expect(tip.cta_route).toBe("/app/cartoes");
    expect(tip.evidence).toMatchObject({ card_id: "c1", amount: 1200 });
  });

  it("detecta cartão pesando acima de 40% da renda do mês", () => {
    const keys = deterministicCandidates({
      ...base,
      cardDebtToday: 900,
      incomeMonth: 2000,
    }).map((c) => c.detector);
    expect(keys).toContain("card_debt_vs_income");
  });

  it("detecta fatura estimada sem documento oficial", () => {
    const keys = deterministicCandidates({ ...base, cardDebtIsEstimated: true }).map((c) => c.detector);
    expect(keys).toContain("card_statement_missing_document");
  });
});
