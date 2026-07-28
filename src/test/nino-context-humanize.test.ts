import { describe, expect, it } from "vitest";
import { humanizeMemoryValue } from "@/pages/NinoContexto";

describe("humanizeMemoryValue — nunca expõe JSON cru", () => {
  it("converte objeto em texto legível", () => {
    const out = humanizeMemoryValue({ merchant: "Uber", amount: 32.5 });
    expect(out).toContain("Estabelecimento: Uber");
    expect(out).toContain("R$");
    expect(out).not.toContain("{");
  });

  it("mantém strings simples", () => {
    expect(humanizeMemoryValue("Prefere avisos pela manhã")).toBe("Prefere avisos pela manhã");
  });

  it("não devolve chaves técnicas vazias", () => {
    expect(humanizeMemoryValue({ payload: { deep: 1 } })).toBe("Sem detalhes registrados.");
  });

  it("trata nulo com mensagem amigável", () => {
    expect(humanizeMemoryValue(null)).toBe("Sem detalhes registrados.");
  });

  it("formata booleanos em português", () => {
    expect(humanizeMemoryValue({ frequency: true })).toBe("Frequência: sim");
  });
});
