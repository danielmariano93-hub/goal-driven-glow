import { describe, it, expect } from "vitest";
import { normalizeDescription } from "../../supabase/functions/_shared/documents/normalize.ts";

describe("normalizeDescription — inferências seguras adicionadas", () => {
  const cases: Array<[string, { friendly: string; category?: string | null; kind?: string | null }]> = [
    ["PAY SOUK4", { friendly: "Market4you", category: "Mercado" }],
    ["Market4you Ltda", { friendly: "Market4you", category: "Mercado" }],
    ["NUTRICAR RESTAURANTE", { friendly: "Nutricar", category: "Alimentação" }],
    ["Pay IFD *iFood", { friendly: "iFood", category: "Alimentação" }],
    ["PAY OXXO 123", { friendly: "OXXO", category: "Mercado" }],
    ["PAY MEP EVENTOS", { friendly: "MEP Eventos", category: "Lazer" }],
    ["Pay Lanchonete Central", { friendly: "Lanche", category: "Alimentação" }],
    ["Mc Donalds Paulista", { friendly: "McDonald's", category: "Alimentação" }],
    ["SEGURO CARTAO ITAU", { friendly: "Seguro do cartão", category: "Seguros" }],
    ["BANCO PAN RECEBIMENTO RENEG 45", { friendly: "Pagamento de renegociação — Banco PAN", category: "Dívidas e empréstimos" }],
    ["Rend Pago Aplic Automatica", { friendly: "Rendimento de aplicação", kind: "investment_yield" }],
    ["Aplicacao CDB DI", { friendly: "Aplicação em CDB", kind: "investment_application" }],
    ["Resgate CDB Liq", { friendly: "Resgate de CDB", kind: "investment_redemption" }],
    ["Estorno Uber Trip", { friendly: "Estorno Uber", category: "Transporte", kind: "refund" }],
    ["EMPRESTIMO CREDITADO CONSIGNADO", { friendly: "Crédito de empréstimo", category: "Dívidas e empréstimos", kind: "loan_proceeds" }],
  ];

  for (const [raw, expected] of cases) {
    it(`classifica "${raw}"`, () => {
      const r = normalizeDescription(raw);
      expect(r.friendly).toBe(expected.friendly);
      if (expected.category !== undefined) expect(r.category_hint).toBe(expected.category);
      if (expected.kind !== undefined) expect(r.movement_kind).toBe(expected.kind);
    });
  }

  it("preserva PIX ambíguo sem inferir estabelecimento nem movement_kind", () => {
    const r = normalizeDescription("PIX ENVIADO FULANO DA SILVA");
    expect(r.friendly).toMatch(/^PIX /);
    expect(r.category_hint).toBeNull();
    expect(r.movement_kind).toBeNull();
  });

  it("não infere movement_kind para gasto comum", () => {
    expect(normalizeDescription("Uber Trip").movement_kind).toBeNull();
    expect(normalizeDescription("Netflix").movement_kind).toBeNull();
  });
});
