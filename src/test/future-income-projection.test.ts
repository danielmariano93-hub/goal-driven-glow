import { describe, expect, it } from "vitest";
import { computeFutureIncomeProjection } from "@/lib/engine/incomeProjection";
import { computeFinancialSnapshot } from "@/lib/engine/metrics";

const tx = (overrides: Record<string, unknown>) => ({
  id: crypto.randomUUID(), account_id: "acc", category_id: null, type: "income", status: "confirmed",
  amount: 5000, occurred_at: "2026-01-30", description: "Salário", transfer_group_id: null,
  ...overrides,
});

describe("future_income.v1", () => {
  it("projeta renda mensal futura sem alterar o saldo real", () => {
    const snapshot = computeFinancialSnapshot({
      accounts: [{ id: "acc", name: "Conta", type: "checking", opening_balance: 1000, active: true }],
      txs: [] as never, recurring: [], snapshots: [], investments: [], debts: [], categoryGoals: [],
      period: { start: "2026-08-01", end: "2026-08-31" }, today: new Date(2026, 7, 10, 12),
      incomeSettings: { approximate_monthly_income: 5000, income_frequency: "mensal", income_day: 30 },
    });
    expect(snapshot.availableToday).toBe(1000);
    expect(snapshot.projection.estimatedFixedInflows).toBe(5000);
    expect(snapshot.projection.freeAfterKnownCommitments).toBe(6000);
  });

  it("não duplica renda planejada compatível", () => {
    const result = computeFutureIncomeProjection({
      settings: { approximate_monthly_income: 5000, income_frequency: "mensal", income_day: 30 },
      txs: [tx({ id: "planned", status: "planned", occurred_at: "2026-08-30" })] as never,
      recurring: [], today: new Date(2026, 7, 10, 12), periodEnd: "2026-08-31",
    });
    expect(result.total).toBe(0);
  });

  it("não projeta novamente quando o salário do ciclo já foi recebido", () => {
    const result = computeFutureIncomeProjection({
      settings: { approximate_monthly_income: 5000, income_frequency: "mensal", income_day: 30 },
      txs: [tx({ id: "received", occurred_at: "2026-08-28" })] as never,
      recurring: [], today: new Date(2026, 7, 29, 12), periodEnd: "2026-08-31",
    });
    expect(result.total).toBe(0);
  });

  it("ajusta dia 31 para fevereiro e infere renda com três meses de histórico", () => {
    const configured = computeFutureIncomeProjection({
      settings: { approximate_monthly_income: 3000, income_frequency: "mensal", income_day: 31 },
      txs: [] as never, recurring: [], today: new Date(2026, 1, 10, 12), periodEnd: "2026-02-28",
    });
    expect(configured.events[0]?.date).toBe("2026-02-28");

    const inferred = computeFutureIncomeProjection({
      settings: null,
      txs: [
        tx({ id: "a", amount: 4100, occurred_at: "2026-05-28" }),
        tx({ id: "b", amount: 4000, occurred_at: "2026-06-29" }),
        tx({ id: "c", amount: 4050, occurred_at: "2026-07-28" }),
      ] as never,
      recurring: [], today: new Date(2026, 7, 10, 12), periodEnd: "2026-08-31",
    });
    expect(inferred.source).toBe("inferred");
    expect(inferred.total).toBe(4050);
  });

  it("não cria data artificial para renda variável sem histórico", () => {
    const result = computeFutureIncomeProjection({
      settings: { approximate_monthly_income: 5000, income_frequency: "variavel", income_day: null },
      txs: [] as never, recurring: [], today: new Date(2026, 7, 10, 12), periodEnd: "2026-08-31",
    });
    expect(result.events).toEqual([]);
  });
});