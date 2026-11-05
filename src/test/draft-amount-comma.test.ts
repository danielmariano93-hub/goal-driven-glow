import { describe, expect, it } from "vitest";
import { resolveDraftAmount } from "../../supabase/functions/_shared/agent/draftAmount";

describe("valor do rascunho de lançamento", () => {
  it("texto com vírgula, como o interpretador entrega (caso real: pix de 10,80 na Autopass)", () => {
    expect(resolveDraftAmount("10,80", "Registrar pix de 10,80 para Autopass")).toBe(10.8);
    expect(resolveDraftAmount("R$ 1.250,50", "")).toBe(1250.5);
  });
  it("número e texto com ponto continuam valendo", () => {
    expect(resolveDraftAmount(21, "")).toBe(21);
    expect(resolveDraftAmount("5.4", "")).toBe(5.4);
    expect(resolveDraftAmount("8", "")).toBe(8);
  });
  it("sem valor no argumento, usa o valor por extenso da frase; sem nada, devolve null", () => {
    expect(resolveDraftAmount(undefined, "gastei cinquenta reais e quarenta centavos")).toBe(50.4);
    expect(resolveDraftAmount(undefined, "gastei na farmácia")).toBeNull();
    expect(resolveDraftAmount("0", "")).toBeNull();
  });
});
