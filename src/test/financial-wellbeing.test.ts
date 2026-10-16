import { describe, it, expect } from "vitest";
import {
  FWB_ITEMS, FWB_TABLE_18_61, FWB_TABLE_62_PLUS, fwbChange, fwbDaysUntilDue, fwbResponseValue, scoreFinancialWellBeing,
} from "@/lib/engine/financialWellBeing";

describe("escala CFPB de bem-estar financeiro", () => {
  it("tem 10 itens e as tabelas oficiais cobrem 0 a 40", () => {
    expect(FWB_ITEMS).toHaveLength(10);
    expect(FWB_TABLE_18_61).toHaveLength(41);
    expect(FWB_TABLE_62_PLUS).toHaveLength(41);
    expect(FWB_ITEMS.filter((i) => i.reverse).map((i) => i.id)).toEqual([3, 5, 6, 7, 9, 10]);
  });

  it("a pior resposta em tudo dá soma 0 e nota 14; a melhor dá soma 40 e nota 86 (18-61) / 95 (62+)", () => {
    const worst = FWB_ITEMS.map((i) => (i.reverse ? 0 : 4));
    const best = FWB_ITEMS.map((i) => (i.reverse ? 4 : 0));
    expect(scoreFinancialWellBeing(worst)).toMatchObject({ total: 0, score: 14 });
    expect(scoreFinancialWellBeing(best)).toMatchObject({ total: 40, score: 86 });
    expect(scoreFinancialWellBeing(best, "62+")).toMatchObject({ total: 40, score: 95 });
  });

  it("inverte os itens negativos: 'Completamente' em 'nunca terei as coisas que quero' vale 0", () => {
    expect(fwbResponseValue(FWB_ITEMS[2], 0)).toBe(0);
    expect(fwbResponseValue(FWB_ITEMS[0], 0)).toBe(4);
    expect(fwbResponseValue(FWB_ITEMS[7], 0)).toBe(4); // "Sempre sobra dinheiro"
    expect(fwbResponseValue(FWB_ITEMS[6], 0)).toBe(0); // "Sempre pesa um presente"
  });

  it("confere pontos da tabela oficial (soma 12 → 40/42; soma 24 → 55/58)", () => {
    expect(FWB_TABLE_18_61[12]).toBe(40);
    expect(FWB_TABLE_62_PLUS[12]).toBe(42);
    expect(FWB_TABLE_18_61[24]).toBe(55);
    expect(FWB_TABLE_62_PLUS[24]).toBe(58);
  });

  it("exige as 10 respostas", () => {
    expect(scoreFinancialWellBeing([0, 1, 2, 3, 4, 0, 1, 2, 3, null])).toBeNull();
    expect(scoreFinancialWellBeing([0, 1, 2])).toBeNull();
  });

  it("repete a cada 15 dias", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(fwbDaysUntilDue(null, now)).toBe(0);
    expect(fwbDaysUntilDue("2026-10-10T12:00:00Z", now)).toBe(9);
    expect(fwbDaysUntilDue("2026-10-01T12:00:00Z", now)).toBe(0);
  });

  it("não narra variação menor que 3 pontos", () => {
    expect(fwbChange(52, 50)?.direction).toBe("same");
    expect(fwbChange(56, 50)).toEqual({ delta: 6, direction: "up" });
    expect(fwbChange(44, 50)?.direction).toBe("down");
    expect(fwbChange(50, null)).toBeNull();
  });
});

describe("texto em português da escala", () => {
  it("só os itens 2, 3 e 10 usam redação validada; os demais ficam declarados como tradução do Nino", () => {
    expect(FWB_ITEMS.filter((i) => i.validatedPt).map((i) => i.id)).toEqual([2, 3, 10]);
    expect(FWB_ITEMS[1].text).toBe("Estou garantindo meu futuro financeiro");
    expect(FWB_ITEMS[9].text).toBe("Minhas finanças controlam minha vida");
  });
});
