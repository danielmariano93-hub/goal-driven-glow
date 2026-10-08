import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { detectCardForPayment } from "../../supabase/functions/_shared/import/cardPayment";

describe("pagamento de fatura ligado ao cartão", () => {
  const one = [{ id: "c1", name: "Cartão Itaú" }];
  const two = [{ id: "c1", name: "Itaú Uniclass" }, { id: "c2", name: "Nubank Roxinho" }];
  it("um único cartão: é ele", () => {
    expect(detectCardForPayment("Pagamento de fatura Fatura Paga Itau Uniclas", one)).toBe("c1");
  });
  it("vários cartões: só se um nome aparecer na descrição", () => {
    expect(detectCardForPayment("Pagamento de fatura Itau Uniclass", two)).toBe("c1");
    expect(detectCardForPayment("Pagamento de fatura", two)).toBeNull();
    expect(detectCardForPayment("Pagamento fatura Itau e Nubank", two)).toBeNull();
  });
  it("sem cartões: nada", () => {
    expect(detectCardForPayment("Pagamento de fatura", [])).toBeNull();
  });
  it("lote grava o cartão detectado, a revisão aceita editar e a confirmação aplica", () => {
    expect(readFileSync("supabase/functions/_shared/import/stage.ts", "utf8")).toContain("detectCardForPayment");
    expect(readFileSync("supabase/functions/assistant-review-actions/index.ts", "utf8")).toContain('"settles_card_id"');
    expect(readFileSync("supabase/migrations/20261008100000_import_card_payment_link.sql", "utf8")).toContain("SET settles_card_id = v_item.settles_card_id");
  });
});
