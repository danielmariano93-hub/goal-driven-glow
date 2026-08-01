import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyCreditSignGuard,
  isCreditDescription,
} from "@/lib/ledger/creditSemantics";
import { buildCanonicalMovement } from "@/lib/ledger/canonical";

/**
 * Onda 1 / P0-2 — fixture REAL do Daniel.
 *
 * Transação d7c2e47e-3110-435a-a403-ae7b3ba9be27, 13/07/2026,
 * "Cancelamento Parcial De ...", R$ 1,46, gravada como `type='expense'`.
 * Somada às demais, produz R$ 5.691,17 por competência 2026-08 contra
 * R$ 4.636,08 do statement oficial.
 */
const DANIEL_CREDIT_FIXTURE = {
  type: "expense" as const,
  amount: 1.46,
  occurred_at: "2026-07-13",
  description: "Cancelamento Parcial De Anuidade Diferenciada",
  credit_card_id: "0780e320-fffb-4cfc-8b87-89a4175a1a36",
  purchase_date: "2026-07-13",
};

describe("creditSemantics — vocabulário de crédito", () => {
  it("reconhece o caso real do Daniel", () => {
    expect(isCreditDescription("Cancelamento Parcial De Anuidade Diferenciada")).toBe(true);
  });

  it.each([
    "Estorno de compra Lovable",
    "ESTORNOS",
    "Reembolso Uber",
    "Devolução de mercadoria",
    "Crédito de compra",
    "Chargeback Google ADS",
    "Reversao de compra",
  ])("reconhece crédito em %s", (descr) => {
    expect(isCreditDescription(descr)).toBe(true);
  });

  it.each([
    "Credito Rotativo",
    "Crédito Parcelado Itaú",
    "Compra a crédito Outback",
    "Lovablelovable.devus",
    "Jim.com",
    null,
    "",
  ])("não trata %s como crédito", (descr) => {
    expect(isCreditDescription(descr as string | null)).toBe(false);
  });
});

describe("applyCreditSignGuard", () => {
  it("converte a despesa de R$ 1,46 do Daniel em estorno", () => {
    const out = applyCreditSignGuard(DANIEL_CREDIT_FIXTURE);
    expect(out.type).toBe("income");
    expect(out.amount).toBe(1.46);
    expect(out.movement_kind).toBe("refund");
    expect(out.credit_guard_reasons).toContain("credit_description_overrides_expense");
  });

  it("trata despesa negativa como crédito e devolve valor absoluto", () => {
    const out = applyCreditSignGuard({ type: "expense", amount: -1053.63, description: "Ajuste" });
    expect(out.type).toBe("income");
    expect(out.amount).toBe(1053.63);
    expect(out.credit_guard_reasons).toContain("negative_expense_is_credit");
  });

  it("não mexe em despesa comum", () => {
    const out = applyCreditSignGuard({ type: "expense", amount: 541.23, description: "Festival" });
    expect(out.type).toBe("expense");
    expect(out.amount).toBe(541.23);
    expect(out.credit_guard_reasons).toEqual([]);
  });

  it("nunca transforma crédito em despesa", () => {
    const out = applyCreditSignGuard({ type: "income", amount: 135.31, description: "Reembolso" });
    expect(out.type).toBe("income");
  });

  it("preserva movimento não-consumo já declarado", () => {
    const out = applyCreditSignGuard({
      type: "expense", amount: -4636.08,
      description: "Pagamento de fatura do cartão", movement_kind: "card_payment",
    });
    expect(out.movement_kind).toBe("card_payment");
  });
});

describe("canonical — crédito de cartão reduz obrigação", () => {
  it("o item do Daniel passa a reduzir a fatura, não aumentá-la", () => {
    // item cru, exatamente como a extração devolveu (type=expense)
    const mov = buildCanonicalMovement({
      document_kind: "invoice",
      item: DANIEL_CREDIT_FIXTURE,
      source_id: "extracted-item-1",
    });
    expect(mov.ledger).toBe("credit_card");
    expect(mov.liability_effect).toBe(-1);
    expect(mov.result_effect).toBe(1);
    expect(mov.cash_effect).toBe(0);
    expect(mov.reasons).toContain("credit_description_overrides_expense");
  });

  it("é idempotente quando a guarda já foi aplicada antes", () => {
    const guarded = applyCreditSignGuard(DANIEL_CREDIT_FIXTURE);
    const mov = buildCanonicalMovement({
      document_kind: "invoice",
      item: guarded,
      source_id: "extracted-item-1b",
    });
    expect(mov.liability_effect).toBe(-1);
    expect(mov.movement_kind).toBe("refund");
  });


  it("sem a guarda o mesmo item aumentaria a obrigação (regressão)", () => {
    const mov = buildCanonicalMovement({
      document_kind: "invoice",
      item: { ...DANIEL_CREDIT_FIXTURE, description: "Compra qualquer" },
      source_id: "extracted-item-2",
    });
    expect(mov.liability_effect).toBe(1);
  });
});

describe("creditSemantics — paridade app × edge function", () => {
  it("mantém os dois arquivos idênticos exceto o cabeçalho de caminho", () => {
    const app = readFileSync("src/lib/ledger/creditSemantics.ts", "utf8");
    const edge = readFileSync("supabase/functions/_shared/ledger/creditSemantics.ts", "utf8");
    const strip = (s: string) => s.replace(/^\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
    expect(strip(edge)).toBe(strip(app));
  });
});
