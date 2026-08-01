import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  allowsBankBalance,
  applyLedgerInvariants,
  buildCanonicalMovement,
  derivePeriod,
  isCardDocument,
  reconciliationDiff,
  resolveLedger,
} from "@/lib/ledger/canonical";

describe("ledger canônico", () => {
  it("fatura sempre resolve para cartão", () => {
    expect(isCardDocument("invoice")).toBe(true);
    expect(resolveLedger("invoice", { type: "expense", amount: 10, occurred_at: "2026-07-01", account_id: "acc" }))
      .toBe("credit_card");
  });

  it("extrato bancário resolve para conta e aceita saldo", () => {
    expect(allowsBankBalance("statement")).toBe(true);
    expect(allowsBankBalance("invoice")).toBe(false);
    expect(resolveLedger("statement", { type: "expense", amount: 10, occurred_at: "2026-07-01", account_id: "acc" }))
      .toBe("bank_account");
  });

  it("compra no cartão não movimenta caixa e aumenta a obrigação", () => {
    const m = buildCanonicalMovement({
      document_kind: "invoice",
      source_id: "document:1:0",
      item: { type: "expense", amount: 100, occurred_at: "2026-07-20", purchase_date: "2026-07-02", account_id: "acc", credit_card_id: "card" },
    });
    expect(m.cash_effect).toBe(0);
    expect(m.liability_effect).toBe(1);
    expect(m.result_effect).toBe(-1);
    expect(m.account_id).toBeNull();
    expect(m.recognition_date).toBe("2026-07-02");
  });

  it("pagamento de fatura reduz caixa e passivo, sem consumo", () => {
    const m = buildCanonicalMovement({
      document_kind: "statement",
      source_id: "document:1:1",
      item: { type: "expense", amount: 500, occurred_at: "2026-07-10", movement_kind: "card_payment", account_id: "acc", credit_card_id: "card" },
    });
    expect(m.cash_effect).toBe(-1);
    expect(m.liability_effect).toBe(-1);
    expect(m.result_effect).toBe(0);
    expect(m.blocks).toHaveLength(0);
  });

  it("bloqueia item de cartão sem cartão selecionado", () => {
    const m = buildCanonicalMovement({
      document_kind: "invoice",
      source_id: "document:1:2",
      item: { type: "expense", amount: 30, occurred_at: "2026-07-05" },
    });
    expect(m.blocks).toContain("missing_credit_card");
  });

  it("aplica invariantes na linha persistida", () => {
    const row = applyLedgerInvariants("invoice", { account_id: "acc", credit_card_id: "card", payment_method: "account" });
    expect(row.account_id).toBeNull();
    expect(row.payment_method).toBe("credit_card");
  });

  it("deriva período pelos itens quando não há metadata", () => {
    expect(derivePeriod({ dates: ["2026-07-10", "2026-07-01", null] }))
      .toEqual({ start: "2026-07-01", end: "2026-07-10", source: "items" });
    expect(derivePeriod({ metadata_start: "2026-06-01", metadata_end: "2026-06-30", dates: [] }).source).toBe("metadata");
  });

  it("detecta divergência material", () => {
    expect(reconciliationDiff(100, 100).material).toBe(false);
    expect(reconciliationDiff(100, 90).material).toBe(true);
    expect(reconciliationDiff(null, 90).difference).toBeNull();
  });

  it("mantém o módulo espelhado nas edge functions", () => {
    const app = fs.readFileSync("src/lib/ledger/canonical.ts", "utf8");
    const edge = fs.readFileSync("supabase/functions/_shared/ledger/canonical.ts", "utf8");
    // Deno exige extensão explícita em import relativo; o resto precisa ser idêntico.
    const strip = (s: string) =>
      s.replace(/(from "\.\/[A-Za-z0-9_./-]+?)\.ts";/g, '$1";').replace(/^\/\/.*$/gm, "");
    expect(strip(edge)).toBe(strip(app));
  });

});
