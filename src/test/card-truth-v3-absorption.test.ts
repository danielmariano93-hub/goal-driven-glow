import { describe, expect, it } from "vitest";
import { computeCardExposure } from "../lib/engine/cardExposure";

// card_exposure.v3 — guardas de absorção: item já pago dentro de fatura fechada
// nunca pode reaparecer como despesa/estimativa de outra competência.
const CARD = "card-itau";

describe("card_truth.v3 — guardas de absorção", () => {
  it("ignora lançamento absorvido por parcela de fatura paga", () => {
    const exposures = computeCardExposure({
      cardIds: [CARD],
      statements: [
        {
          credit_card_id: CARD,
          competence_month: "2026-07-01",
          stated_total: 4636.08,
          paid_amount: 4636.08,
          outstanding_amount: 0,
          reconciliation_difference: 0,
          status: "paid",
          id: "stmt-jul",
        } as never,
      ],
      installments: [
        {
          id: "inst-1",
          credit_card_id: CARD,
          competence_month: "2026-07-01",
          amount: 500,
          status: "paid",
          absorbed_by_statement_id: "stmt-jul",
          legacy_transaction_id: "tx-legacy",
        },
      ],
      // lançamento legado com competência errada em agosto
      txs: [
        {
          id: "tx-legacy",
          credit_card_id: CARD,
          competence_date: "2026-08-01",
          occurred_at: "2026-07-10",
          amount: 500,
          type: "expense",
          status: "confirmed",
          movement_kind: "transaction",
        },
      ],
      currentYM: "2026-08",
      todayISO: "2026-08-18",
    });

    const e = exposures[CARD];
    expect(e.currentStatement.amount).toBe(0);
    expect(e.excludedAbsorbed).toBeGreaterThan(0);
    expect(e.excludedCount).toBeGreaterThan(0);
  });

  it("não conta pagamento de fatura como consumo de cartão", () => {
    const exposures = computeCardExposure({
      cardIds: [CARD],
      statements: [],
      installments: [],
      txs: [
        {
          id: "tx-pay",
          credit_card_id: CARD,
          settles_card_id: CARD,
          competence_date: "2026-08-01",
          occurred_at: "2026-08-01",
          amount: 1000,
          type: "expense",
          status: "confirmed",
          movement_kind: "card_payment",
        },
        {
          id: "tx-buy",
          credit_card_id: CARD,
          competence_date: "2026-08-01",
          occurred_at: "2026-08-02",
          amount: 120,
          type: "expense",
          status: "confirmed",
          movement_kind: "transaction",
        },
      ],
      currentYM: "2026-08",
      todayISO: "2026-08-18",
    });

    expect(exposures[CARD].currentStatement.amount).toBe(120);
  });

  it("decompõe a fatura estimada em compras novas e parcelas contratadas", () => {
    const exposures = computeCardExposure({
      cardIds: [CARD],
      statements: [],
      installments: [
        {
          id: "inst-fut",
          credit_card_id: CARD,
          competence_month: "2026-08-01",
          amount: 200,
          status: "scheduled",
        },
      ],
      txs: [
        {
          id: "tx-new",
          credit_card_id: CARD,
          competence_date: "2026-08-05",
          occurred_at: "2026-08-05",
          amount: 80,
          type: "expense",
          status: "confirmed",
          movement_kind: "transaction",
        },
      ],
      currentYM: "2026-08",
      todayISO: "2026-08-18",
    });

    const b = exposures[CARD].currentStatement.breakdown;
    expect(b?.newPurchases).toBe(80);
    expect(b?.contractedInstallments).toBe(200);
    expect(exposures[CARD].currentStatement.amount).toBe(280);
  });
});
