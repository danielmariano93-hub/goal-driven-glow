import { describe, expect, it } from "vitest";
import { blocksForTools, composeSystemPrompt, DEFAULT_SYSTEM_PROMPT, PROMPT_BLOCKS } from "../../supabase/functions/_shared/agent/prompt.ts";

describe("nino_efficiency.v2 — prompt por competência", () => {
  it("mantém identidade, tom, estilo e glossário em qualquer escopo", () => {
    const p = composeSystemPrompt([]);
    expect(p).toContain("IDENTIDADE");
    expect(p).toContain("NUNCA VAZE NOMES INTERNOS");
    expect(p).toContain("Patrimônio líquido");
  });
  it("turno só de leitura não carrega as regras de escrita", () => {
    const blocks = blocksForTools(["get_financial_snapshot", "analyze_spending"]);
    expect(blocks).not.toContain("entry");
    const p = composeSystemPrompt(blocks);
    expect(p).not.toContain("Regras invioláveis");
    expect(p.length).toBeLessThan(DEFAULT_SYSTEM_PROMPT.length);
  });
  it("turno de lançamento carrega as regras de escrita", () => {
    const p = composeSystemPrompt(blocksForTools(["create_transaction_draft"]));
    expect(p).toContain("Regras invioláveis");
  });
  it("consultoria carrega o bloco de consultor", () => {
    const p = composeSystemPrompt(blocksForTools(["plan_installment_decision"]));
    expect(p).toContain("PAPEL DE CONSULTOR");
  });
  it("escopo desconhecido cai no prompt completo", () => {
    expect(composeSystemPrompt(blocksForTools(null))).toBe(DEFAULT_SYSTEM_PROMPT);
  });
  it("nenhum bloco vazio", () => {
    for (const [k, v] of Object.entries(PROMPT_BLOCKS)) expect(v.trim().length, k).toBeGreaterThan(50);
  });
});
