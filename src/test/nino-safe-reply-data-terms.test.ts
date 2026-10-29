// Barreira de vazamento de infraestrutura (`nino_safety.v2`): termo que está nos
// DADOS do usuário (estabelecimento "Lovable", "Claude Code") não é vazamento.
import { describe, expect, it } from "vitest";
import { leaksInfrastructure, sanitizeUserFacingText, USER_SAFE_MESSAGES } from "../../supabase/functions/_shared/agent/core/UserSafeError.ts";

const evidence = JSON.stringify([{ groups: [{ label: "Lovable" }, { label: "Claude Code" }, { label: "OpenAI" }] }]).toLowerCase();

describe("termos que vêm dos dados", () => {
  it("estabelecimento com nome de fornecedor passa quando está na evidência", () => {
    const text = "• *Lovable* — R$ 169,29\n• *Claude Code* — R$ 120,00\n• *OpenAI* — R$ 100,00";
    expect(leaksInfrastructure(text)).toBe(true);
    expect(leaksInfrastructure(text, evidence)).toBe(false);
    expect(sanitizeUserFacingText(text, "AI_TEMPORARY_UNAVAILABLE", evidence)).toBe(text);
  });

  it("o mesmo termo FORA da evidência continua barrado", () => {
    const text = "Não consegui porque o provider da OpenAI retornou erro.";
    expect(sanitizeUserFacingText(text, "AI_TEMPORARY_UNAVAILABLE", JSON.stringify([{ groups: [{ label: "Mercado" }] }]).toLowerCase()))
      .toBe(USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE);
  });

  it("outro termo de infraestrutura junto ao nome legítimo ainda barra a frase", () => {
    const text = "Lovable aparece, mas o gateway 429 falhou.";
    expect(leaksInfrastructure(text, evidence)).toBe(true);
  });

  it("sem evidência o comportamento é o de antes", () => {
    expect(leaksInfrastructure("Gastei no Mercado R$ 10,00")).toBe(false);
    expect(leaksInfrastructure("rate limit do provider")).toBe(true);
  });
});
