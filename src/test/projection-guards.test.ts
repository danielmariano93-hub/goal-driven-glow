import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { computeFinancialSnapshot } from "@/lib/engine/metrics";

const LEGACY_FIELDS = [
  "monthToDateAverageConsumption",
  "projectedRemainingConsumption",
  "projectedMonthEndAvailable",
  "currentAverageDailyConsumption",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("verdade financeira única — guardas de contrato", () => {
  it("nenhum componente ou página usa campos legados de projeção", () => {
    const files = [...walk("src/components"), ...walk("src/pages")];
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const field of LEGACY_FIELDS) {
        if (source.includes(field)) offenders.push(`${file}:${field}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("pagamento de fatura planejado não entra duas vezes na projeção", () => {
    const base = {
      accounts: [{ id: "acc", name: "Conta", type: "checking", opening_balance: 5000, active: true }] as never,
      recurring: [],
      snapshots: [] as never,
      investments: [],
      debts: [],
      categoryGoals: [],
      period: { start: "2026-03-01", end: "2026-03-31" },
      today: new Date(2026, 2, 10),
    };
    const semPagamento = computeFinancialSnapshot({ ...base, txs: [] as never });
    const comPagamento = computeFinancialSnapshot({
      ...base,
      txs: [{
        id: "pay",
        type: "expense",
        amount: 800,
        occurred_at: "2026-03-20",
        posted_at: "2026-03-20",
        status: "planned",
        account_id: "acc",
        category_id: null,
        settles_card_id: "card-1",
        description: "Pagamento de fatura",
      }] as never,
    });
    expect(comPagamento.projection.upcomingConfirmedCommitments)
      .toBe(semPagamento.projection.upcomingConfirmedCommitments);
  });

  it("gasto fixo do mês não é reprojetado como gasto variável", () => {
    const txs = [{
      id: "rent",
      type: "expense",
      amount: 3000,
      occurred_at: "2026-03-02",
      posted_at: "2026-03-02",
      status: "confirmed",
      account_id: "acc",
      category_id: "cat-moradia",
      description: "Aluguel",
    }] as never;
    const snap = computeFinancialSnapshot({
      accounts: [{ id: "acc", name: "Conta", type: "checking", opening_balance: 9000, active: true }] as never,
      txs,
      recurring: [],
      snapshots: [] as never,
      investments: [],
      debts: [],
      categoryGoals: [],
      categoryNameById: { "cat-moradia": "Moradia" },
      period: { start: "2026-03-01", end: "2026-03-31" },
      today: new Date(2026, 2, 10),
    });
    expect(snap.projection.realizedConsumption).toBe(3000);
    expect(snap.projection.currentVariablePace).toBe(0);
    expect(snap.projection.projectedVariableSpending).toBe(0);
  });
});
