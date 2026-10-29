// Transparência de escopo herdado (`nino_scope_transparency.v1`).
import { describe, expect, it } from "vitest";
import { inheritedScopeFilters, inheritedScopeNote } from "../../supabase/functions/_shared/agent/core/InheritedScopeNote.ts";

const uber = { field: "merchant", value: "Uber" };
const account = { field: "account", value: "Banco Itau" };

describe("recorte herdado", () => {
  it("pergunta nova sem o recorte avisa o que foi considerado (caso real do piloto)", () => {
    const note = inheritedScopeNote("em que dia da semana eu mais gasto em setembro?", [uber, account]);
    expect(note).toContain("estabelecimento Uber");
    expect(note).toContain("conta Banco Itau");
    expect(note).toContain("é só me dizer");
  });

  it("recorte dito na própria frase não gera aviso", () => {
    expect(inheritedScopeNote("gastos no Uber por categoria em setembro", [uber])).toBeNull();
    expect(inheritedScopeNote("quanto gastei no cartão Itaú?", [{ field: "card", value: "Cartão Itaú" }])).toBeNull();
    expect(inheritedScopeNote("gastos na conta Itau", [account])).toBeNull();
  });

  it("acento e caixa não atrapalham", () => {
    expect(inheritedScopeNote("GASTOS COM ALIMENTAÇÃO", [{ field: "category", value: "alimentacao" }])).toBeNull();
  });

  it("forma de pagamento dita ('no cartão') não avisa; não dita avisa", () => {
    const pm = { field: "payment_method", value: "credit_card" };
    expect(inheritedScopeNote("e no cartão?", [pm])).toBeNull();
    expect(inheritedScopeNote("e em agosto?", [pm])).toContain("forma de pagamento");
  });

  it("follow-up elíptico herdando o estabelecimento também é declarado", () => {
    const note = inheritedScopeNote("e por categoria?", [uber]);
    expect(note).toContain("Uber");
  });

  it("sem filtros ou texto vazio não gera aviso e não duplica filtros", () => {
    expect(inheritedScopeNote("qualquer", [])).toBeNull();
    expect(inheritedScopeNote("", [uber])).toBeNull();
    expect(inheritedScopeFilters("e agosto?", [uber, { ...uber }]).length).toBe(1);
  });
});
