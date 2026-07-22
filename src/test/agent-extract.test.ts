import { describe, it, expect } from "vitest";
import { extractSpans } from "@/lib/agent/extract";

describe("extractSpans — sem blacklist, preserva literal", () => {
  it("131,51 de VOS no cartão de crédito Itaú → description=VOS, card=Itaú", () => {
    const r = extractSpans("Registre um gasto de 131,51 de VOS no cartão de crédito Itaú");
    expect(r.amount).toBe(131.51);
    expect(r.payment_method).toBe("credit_card");
    expect(r.card_hint?.toLowerCase()).toBe("itaú");
    expect(r.description).toBe("VOS");
  });

  it("paguei análise de crédito no Itaú (débito/conta) → preserva 'análise de crédito'", () => {
    const r = extractSpans("paguei 200 de análise de crédito na conta Itaú");
    expect(r.amount).toBe(200);
    expect(r.payment_method).toBe("account");
    expect(r.account_hint?.toLowerCase()).toBe("itaú");
    expect(r.description).toBe("análise de crédito");
  });

  it("VOS não deve ser convertido para VPS", () => {
    const r = extractSpans("gastei 50 em VOS");
    expect(r.description).toBe("VOS");
    expect(r.description).not.toBe("VPS");
  });

  it("12x no cartão captura parcelamento", () => {
    const r = extractSpans("comprei um notebook por 3000 em 12x no cartão Nubank");
    expect(r.amount).toBe(3000);
    expect(r.installments_total).toBe(12);
    expect(r.payment_method).toBe("credit_card");
    expect(r.card_hint?.toLowerCase()).toBe("nubank");
    expect(r.description.toLowerCase()).toContain("notebook");
  });

  it("hoje/ontem → ISO date", () => {
    const r = extractSpans("gastei 30 no mercado ontem");
    expect(r.amount).toBe(30);
    expect(r.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.category_hint).toBe("mercado");
  });

  it("sem cartão nem conta explícita → método null, description limpa", () => {
    const r = extractSpans("gastei 45 em uber");
    expect(r.amount).toBe(45);
    expect(r.payment_method).toBeNull();
    expect(r.description).toBe("uber");
  });

  it("valor em R$ com decimal", () => {
    const r = extractSpans("R$ 1.234,56 de aluguel");
    expect(r.amount).toBe(1234.56);
    expect(r.description.toLowerCase()).toBe("aluguel");
  });

  it("cartão sem marca → card_hint vazio (resolve para cartão único)", () => {
    const r = extractSpans("gastei 80 no cartão");
    expect(r.payment_method).toBe("credit_card");
    expect(r.card_hint).toBe("");
    expect(r.description).toBe("");
  });

  it("mensagem rotulada do banco vira extração estrutural sem LLM", () => {
    const r = extractSpans("Compra aprovada\nValor: R$ 11,89\nEstabelecimento: Souk4u\nCartão: Nubank\nData: 21 de julho de 2026");
    expect(r.amount).toBe(11.89);
    expect(r.payment_method).toBe("credit_card");
    expect(r.card_hint).toBe("Nubank");
    expect(r.description).toBe("Souk4u");
    expect(r.occurred_at).toBe("2026-07-21");
  });
});

describe("extractSpans — notificação bancária com 'Conta Corrente <Banco>'", () => {
  it("detecta account_hint mesmo sem rótulo com dois-pontos", async () => {
    const { extractSpans } = await import("@/lib/agent/extract");
    const msg = [
      "Registre esse novo gasto:",
      "Valor: R$ 30,00",
      "Estabelecimento: A Ventana Itau Ceic",
      "Data: 22/07/2026",
      "Conta Corrente Itaú",
    ].join("\n");
    const r = extractSpans(msg);
    expect(r.amount).toBe(30);
    expect(r.payment_method).toBe("account");
    expect(r.account_hint?.toLowerCase()).toContain("ita");
  });
});
