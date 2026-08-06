import { describe, expect, it } from "vitest";
import { computeRhythm } from "@/lib/engine/spendingRhythm";
import { computeCardExposure } from "@/lib/engine/cardExposure";

const tx = (over: Record<string, unknown>) => ({
  id: "t", account_id: "a", type: "expense", status: "confirmed",
  amount: 100, occurred_at: "2026-07-05", category_id: null,
  transfer_group_id: null, ...over,
}) as never;

const range = { start: "2026-07-01", end: "2026-07-31" };

describe("E4 — ritmo típico explicável", () => {
  it("mantém parcelamento curto no ritmo típico (não é exclusão automática)", () => {
    const r = computeRhythm([tx({ id: "p", amount: 300, installments_total: 3, origin: "manual" })], range);
    expect(r.excluded).toHaveLength(0);
    expect(r.typicalTotal).toBe(300);
  });

  it("exclui parcela de compromisso recorrente", () => {
    const r = computeRhythm([tx({ id: "p", amount: 300, installments_total: 12, origin: "recurring" })], range);
    expect(r.excluded[0].reason).toBe("recurring");
    expect(r.typicalTotal).toBe(0);
  });

  it("usa classificação declarativa da categoria antes do fallback por nome", () => {
    const declared = computeRhythm(
      [tx({ id: "x", amount: 500, category_id: "cat-1" })],
      range,
      { categoryKindById: { "cat-1": "structural" }, categoryNameById: { "cat-1": "Rolê" } },
    );
    expect(declared.excluded[0].reason).toBe("fixed");

    const byIds = computeRhythm(
      [tx({ id: "x", amount: 500, category_id: "cat-1" })],
      range,
      { structuralCategoryIds: ["cat-1"] },
    );
    expect(byIds.excludedTotal).toBe(500);
  });

  it("agrupa o que ficou de fora por motivo", () => {
    const r = computeRhythm([
      tx({ id: "a", amount: 200, origin: "recurring" }),
      tx({ id: "b", amount: 300, category_id: "c", occurred_at: "2026-07-06" }),
    ], range, { categoryKindById: { c: "structural" } });
    const reasons = r.excludedByReason.map((g) => g.reason);
    expect(reasons).toContain("recurring");
    expect(reasons).toContain("fixed");
    expect(r.excludedByReason.reduce((s, g) => s + g.total, 0)).toBe(r.excludedTotal);
  });
});

describe("E6 — parcelas absorvidas por fatura", () => {
  it("ignora parcela marcada como absorvida no compromisso futuro", () => {
    const base = {
      cardIds: ["card"],
      statements: [],
      txs: [],
      currentYM: "2026-08",
    };
    const open = computeCardExposure({
      ...base,
      installments: [{ credit_card_id: "card", competence_month: "2026-09-01", amount: 250, status: "scheduled" }],
    });
    expect(open.card.futureInstallments).toBe(250);

    const absorbed = computeCardExposure({
      ...base,
      installments: [{
        credit_card_id: "card", competence_month: "2026-09-01", amount: 250,
        status: "scheduled", absorbed_by_statement_id: "st-1",
      }],
    });
    expect(absorbed.card.futureInstallments).toBe(0);
  });

  it("não soma novamente a parcela que já existe como transação no ledger", () => {
    const exposure = computeCardExposure({
      cardIds: ["card"], statements: [], currentYM: "2026-08",
      txs: [{ id: "tx-installment", credit_card_id: "card", competence_date: "2026-08-01", amount: 120, type: "expense", status: "confirmed" }],
      installments: [{ id: "inst", credit_card_id: "card", competence_month: "2026-08-01", amount: 120, status: "scheduled", legacy_transaction_id: "tx-installment" }],
    });
    expect(exposure.card.currentStatement.amount).toBe(120);
    expect(exposure.card.currentStatement.purchasesAmount).toBe(120);
    expect(exposure.card.currentStatement.installmentsAmount).toBe(0);
  });
});
