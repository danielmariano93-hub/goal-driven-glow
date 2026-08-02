import { describe, expect, it } from "vitest";
import { deterministicCandidates } from "../../supabase/functions/_shared/insights/detectors";
import { DETECTOR_CATALOG, unsupportedNumbers } from "../../supabase/functions/_shared/insights/contracts";

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

describe("insights_catalog.v1 — detectores determinísticos", () => {
  it("não dispara nada sem evidência", () => {
    expect(deterministicCandidates(base)).toHaveLength(0);
  });

  it("detecta risco quando o mês gasta mais do que entra", () => {
    const out = deterministicCandidates({ ...base, expenseMonth: 5000, incomeMonth: 4000 });
    expect(out.map((c) => c.detector)).toContain("financial_risk");
  });

  it("detecta anomalia de valor acima de 3x o típico", () => {
    const out = deterministicCandidates({
      ...base,
      amountAnomaly: { description: "Notebook", amount: 4500, typicalAmount: 120, occurredAt: "2026-08-01" },
    });
    const hit = out.find((c) => c.detector === "amount_anomaly");
    expect(hit).toBeTruthy();
    expect(hit!.evidence.amount).toBe(4500);
  });

  it("detecta crescimento de categoria só com base anterior real", () => {
    const noBase = deterministicCandidates({
      ...base,
      categoryGrowth: { name: "Delivery", current: 800, previous: 0, growthPct: 100 },
    });
    expect(noBase.map((c) => c.detector)).not.toContain("category_growth");
    const withBase = deterministicCandidates({
      ...base,
      categoryGrowth: { name: "Delivery", current: 800, previous: 400, growthPct: 100 },
    });
    expect(withBase.map((c) => c.detector)).toContain("category_growth");
  });

  it("todo detector emitido existe no catálogo com evidência obrigatória", () => {
    const out = deterministicCandidates({
      ...base,
      expenseMonth: 5000,
      incomeMonth: 4000,
      upcomingCommitments30d: 3000,
      availableToday: 1000,
      subscriptions: { count: 4, total: 240 },
      recurringMerchant: { name: "iFood", occurrences: 6, total: 480 },
      rhythm: { dailyTypical: 150, daysLeft: 10, projectedExpense: 4500 },
      uncategorizedCount: 5,
      daysWithoutEntry: 6,
    });
    expect(out.length).toBeGreaterThan(5);
    for (const c of out) {
      const meta = DETECTOR_CATALOG[c.detector as keyof typeof DETECTOR_CATALOG];
      expect(meta, c.detector).toBeTruthy();
      for (const field of meta.requires) expect(Object.keys(c.evidence)).toContain(field);
    }
  });
});

describe("guardrail numérico", () => {
  it("aceita números presentes na evidência", () => {
    expect(unsupportedNumbers("Você gastou R$ 1.250,00 em Delivery", { amount: 1250 })).toEqual([]);
  });

  it("rejeita número inventado", () => {
    expect(unsupportedNumbers("Você gastou R$ 9.999,00", { amount: 1250 }).length).toBeGreaterThan(0);
  });

  it("ignora números triviais (dias, parcelas)", () => {
    expect(unsupportedNumbers("Vence em 12 dias, em 3 parcelas", {})).toEqual([]);
  });
});
