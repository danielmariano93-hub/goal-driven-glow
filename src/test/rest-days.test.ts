import { describe, expect, it } from "vitest";
import { restDaysText, restDaysToFit } from "@/lib/engine/restDays";

describe("dias sem gastar para fechar sem estourar", () => {
  it("ritmo de 42 com 21 por dia disponíveis: metade dos dias sem gastar", () => {
    const r = restDaysToFit(525, 25, 42);
    expect(r).toEqual({ spendDays: 12, restDays: 13, daysLeft: 25 });
  });
  it("já cabe no ritmo atual: não mostra nada", () => {
    expect(restDaysToFit(1000, 20, 40)).toBeNull();
    expect(restDaysToFit(800, 20, 40)).toBeNull();
  });
  it("sem base (saldo zero, sem dias, ritmo zero ou inválido)", () => {
    expect(restDaysToFit(0, 10, 30)).toBeNull();
    expect(restDaysToFit(-5, 10, 30)).toBeNull();
    expect(restDaysToFit(100, 0, 30)).toBeNull();
    expect(restDaysToFit(100, 10, 0)).toBeNull();
    expect(restDaysToFit(NaN, 10, 30)).toBeNull();
  });
  it("não cobre nem um dia: todos sem gastar", () => {
    expect(restDaysToFit(10, 5, 40)).toEqual({ spendDays: 0, restDays: 5, daysLeft: 5 });
  });
  it("frase neutra, com singular e plural", () => {
    const brl = (v: number) => `R$ ${v}`;
    expect(restDaysText({ spendDays: 12, restDays: 13, daysLeft: 25 }, 42, brl)).toBe("Mantendo R$ 42 nos dias em que gastar, daria para fechar sem estourar com cerca de 13 dias sem gastar nada nos próximos 25 dias.");
    expect(restDaysText({ spendDays: 1, restDays: 1, daysLeft: 2 }, 40, brl)).toContain("1 dia sem gastar");
  });
});
