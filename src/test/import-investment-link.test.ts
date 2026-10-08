import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeInvestmentName, suggestInvestment } from "../../supabase/functions/_shared/import/investmentLink";

const cdb = { id: "i1", name: "CDB DI Itaú" };
const fundo = { id: "i2", name: "Fundo de Investimentos" };

describe("resgate/aplicação: qual investimento?", () => {
  it("normaliza como o SQL (acento, palavras genéricas, banco)", () => {
    expect(normalizeInvestmentName("Aplicação CDB DI Itaú")).toBe("cdb di");
    expect(normalizeInvestmentName("Resgate INT RESGATE ITUBERS")).toBe("int itubers");
    expect(normalizeInvestmentName("Resgate de investimento")).toBeNull();
  });
  it("nome único bate; sem pista, não chuta", () => {
    expect(suggestInvestment("Aplicação CDB DI Itaú", [cdb, fundo], [])).toBe("i1");
    expect(suggestInvestment("Resgate de investimento", [cdb, fundo], [])).toBeNull();
    expect(suggestInvestment("Resgate INT RESGATE ITUBERS", [cdb, fundo], [])).toBeNull();
  });
  it("apelido aprendido vence", () => {
    const alias = [{ investment_id: "i1", normalized_alias: "int itubers" }];
    expect(suggestInvestment("Resgate INT RESGATE ITUBERS", [cdb, fundo], alias)).toBe("i1");
  });
  it("dois ativos com o mesmo nome: nunca escolhe", () => {
    expect(suggestInvestment("CDB DI", [cdb, { id: "i3", name: "CDB DI Bradesco" }], [])).toBeNull();
  });
  it("lote sugere, revisão escolhe, confirmação grava e aprende o apelido", () => {
    expect(readFileSync("supabase/functions/_shared/import/stage.ts", "utf8")).toContain("suggestInvestment");
    expect(readFileSync("supabase/functions/assistant-review-actions/index.ts", "utf8")).toContain('"investment_id"');
    expect(readFileSync("src/components/assessor/ReviewSheet.tsx", "utf8")).toContain("InvestmentPicker");
    const sql = readFileSync("supabase/migrations/20261008400000_import_investment_link.sql", "utf8");
    expect(sql).toContain("investment_id");
    expect(sql).toContain("investment_aliases");
  });
});
