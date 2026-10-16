import { describe, expect, it } from "vitest";
import { parseMoney, previousMonthOf } from "@/lib/mapa/questions";

describe("utilitários das perguntas do Mapa", () => {
  it("parseMoney aceita formatos brasileiros e rejeita lixo", () => {
    expect(parseMoney("4.500,50")).toBe(4500.5);
    expect(parseMoney("4500")).toBe(4500);
    expect(parseMoney("4.500")).toBe(4500);
    expect(parseMoney("R$ 3,5")).toBe(3.5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
  it("mês anterior atravessa o ano", () => {
    expect(previousMonthOf("2026-10-16")).toEqual({ ym: "2026-09", name: "setembro" });
    expect(previousMonthOf("2027-01-03")).toEqual({ ym: "2026-12", name: "dezembro" });
  });
});
