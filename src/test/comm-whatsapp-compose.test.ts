import { describe, expect, it } from "vitest";
import { composeWhatsappBody } from "../../supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts";

describe("composição final do WhatsApp", () => {
  it("não repete o título quando o corpo já começa com ele", () => {
    expect(composeWhatsappBody("Sua fatura fecha amanhã", "Sua fatura fecha amanhã, e o valor está em R$ 1.200,00."))
      .toBe("Sua fatura fecha amanhã, e o valor está em R$ 1.200,00.");
  });

  it("mantém título quando o corpo traz outro assunto", () => {
    expect(composeWhatsappBody("Parcela do Banco Sim", "Vence dia 4, no valor de R$ 97,06."))
      .toBe("Parcela do Banco Sim\n\nVence dia 4, no valor de R$ 97,06.");
  });

  it("tolera título ou corpo vazio", () => {
    expect(composeWhatsappBody("", "só o corpo")).toBe("só o corpo");
    expect(composeWhatsappBody("só o título", "")).toBe("só o título");
  });
});
