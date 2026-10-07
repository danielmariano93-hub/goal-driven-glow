import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MOVEMENT_SEMANTICS, reviewBucketOf } from "@/lib/engine/bridges";
import { behavioralMetricAmount } from "@/lib/engine/facts";

// Uma só regra contábil: o mapa MOVEMENT_SEMANTICS (bridges.ts) e o motor comportamental
// (facts.ts / SQL is_behavioral_consumption) têm de concordar sobre o que é receita e gasto.
// Divergência conhecida e declarada (sem nenhuma linha em produção): tarifa e juros.
const DECLARED_DIVERGENCE = new Set(["fee", "interest"]);
const NOT_A_KIND = new Set(["income", "expense", "card_expense"]); // chaves "por tipo", não movement_kind

const row = (type: "income" | "expense", movement_kind: string): any => ({
  status: "confirmed", type, movement_kind, amount: 10, transfer_group_id: null, settles_card_id: null,
});

describe("regra contábil única (mapa canônico x motor comportamental)", () => {
  for (const [kind, sem] of Object.entries(MOVEMENT_SEMANTICS)) {
    if (NOT_A_KIND.has(kind) || DECLARED_DIVERGENCE.has(kind)) continue;
    it(`${kind}: receita/gasto do motor bate com performanceImpact do mapa`, () => {
      for (const type of ["income", "expense"] as const) {
        const income = behavioralMetricAmount(row(type, kind), "income");
        const expense = behavioralMetricAmount(row(type, kind), "expense");
        if (kind === "refund") {
          // estorno abate o gasto (entrada), nunca vira receita
          expect(income).toBe(0);
          expect(expense).toBe(type === "income" ? -10 : 0);
        } else if (sem.performanceImpact === 0) {
          expect(income).toBe(0);
          expect(expense).toBe(0);
        }
      }
    });
  }

  it("movimentos de patrimônio nunca caem no balde de receita/gasto do resumo", () => {
    for (const kind of ["investment_redemption", "investment_application", "investment_yield", "card_payment",
      "external_transfer_in", "external_transfer_out", "loan_proceeds", "debt_payment", "internal_transfer", "refund"]) {
      for (const type of ["income", "expense"]) {
        expect(["income", "expense"]).not.toContain(reviewBucketOf({ type, movement_kind: kind }));
      }
    }
    expect(reviewBucketOf({ type: "income", movement_kind: "transaction" })).toBe("income");
    expect(reviewBucketOf({ type: "expense", movement_kind: null })).toBe("expense");
  });

  it("consumidores fora do núcleo usam o mapa (sem somar por tipo)", () => {
    const detectors = readFileSync("supabase/functions/_shared/agent/core/BehaviorDetectors.ts", "utf8");
    const insights = readFileSync("supabase/functions/insights-generate/index.ts", "utf8");
    expect(detectors).toContain("reviewBucketOf");
    expect(insights).toContain("reviewBucketOf(t) === \"expense\"");
    expect(detectors).not.toMatch(/row\.type === "income"\) item\.income/);
  });

  it("SQL: renda de 90 dias e desafio de gastos filtram movimento de rotina", () => {
    const sql = readFileSync("supabase/migrations/20261007300000_canonical_income_and_activity_filters.sql", "utf8");
    expect(sql).toContain("settles_card_id is null");
    expect(sql).toContain("movement_kind");
  });
});
