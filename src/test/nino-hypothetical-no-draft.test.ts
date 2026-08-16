import { describe, it, expect } from "vitest";
import { allowsEntryDraft, isHypotheticalStatement } from "@/lib/agent/hypothetical";
import { interpret, parseBrAmountWithScale } from "@/lib/agent/parser";
import { extractSpans } from "@/lib/agent/extract";

describe("guarda de hipótese — consultoria nunca vira lançamento", () => {
  const hypo = "se a partir de setembro eu tivesse mais um gasto fixo de aproximadamente 3 mil reais por mês, como fica?";

  it("detecta frase hipotética", () => {
    expect(isHypotheticalStatement(hypo)).toBe(true);
    expect(allowsEntryDraft(hypo)).toBe(false);
  });

  it("não produz intenção de transação a partir da hipótese", () => {
    expect(interpret(hypo).kind).toBe("unknown");
    expect(interpret("se eu comprasse um carro de 90 mil, cabe no meu mês?").kind).toBe("unknown");
  });

  it("registro real continua funcionando", () => {
    expect(allowsEntryDraft("gastei 50,40 no KFC")).toBe(true);
    expect(interpret("gastei 50,40 no KFC").kind).toBe("transaction");
  });
});

describe("multiplicador de escala pt-BR", () => {
  it("3 mil reais = 3000", () => {
    expect(parseBrAmountWithScale("3", " mil reais por mês")).toBe(3000);
    expect(parseBrAmountWithScale("1,5", " mil")).toBe(1500);
    expect(parseBrAmountWithScale("2", " milhões")).toBe(2_000_000);
    expect(parseBrAmountWithScale("50", ",40 no KFC")).toBe(50);
  });

  it("extração de span aplica a escala e não deixa 'mil' na descrição", () => {
    const r = extractSpans("registre um gasto de 3 mil de aluguel");
    expect(r.amount).toBe(3000);
    expect((r.description ?? "").toLowerCase()).not.toContain("mil");
  });
});
