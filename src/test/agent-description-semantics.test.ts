// Guardrails semânticos: descrição do lançamento nunca deve ser apenas o meio
// de pagamento. Testa a normalização e a lista de termos proibidos.
import { describe, it, expect } from "vitest";

const METHOD_ONLY_TERMS = new Set([
  "credito","crédito","debito","débito","pix","dinheiro","cartao","cartão",
  "boleto","transferencia","transferência","ted","doc","fatura","credit_card","account",
]);

function normalizeDesc(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

function isMethodOnly(s: string): boolean {
  return METHOD_ONLY_TERMS.has(normalizeDesc(s));
}

describe("agent description semantics", () => {
  it("blocks method-only descriptions", () => {
    expect(isMethodOnly("crédito")).toBe(true);
    expect(isMethodOnly("Crédito")).toBe(true);
    expect(isMethodOnly("credito")).toBe(true);
    expect(isMethodOnly("PIX")).toBe(true);
    expect(isMethodOnly("cartão")).toBe(true);
    expect(isMethodOnly("boleto")).toBe(true);
    expect(isMethodOnly("transferência")).toBe(true);
  });
  it("allows real descriptions", () => {
    expect(isMethodOnly("mercado")).toBe(false);
    expect(isMethodOnly("VPS")).toBe(false);
    expect(isMethodOnly("almoço no bar")).toBe(false);
    expect(isMethodOnly("gasolina posto shell")).toBe(false);
  });
});
