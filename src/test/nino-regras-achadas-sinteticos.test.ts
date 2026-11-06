import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Falhas achadas pelos usuários sintéticos viram regra permanente no interpretador semântico.
const prompt = readFileSync("supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts", "utf8");

describe("regras nascidas de falhas dos usuários sintéticos", () => {
  it("'quanto sobrou' em período passado é balanço do período, não total gasto nem patrimônio", () => {
    expect(prompt).toMatch(/35l2\..*Quanto sobrou em outubro.*period_review/s);
    expect(prompt).toMatch(/NUNCA responda só o total gasto nem o patrimônio/);
  });
  it("seguimento elíptico exige marcador e troca só a métrica ou o período", () => {
    expect(prompt).toMatch(/35l3\. SEGUIMENTO ELÍPTICO sobre o turno anterior: SÓ quando a frase COMEÇA com marcador/);
    expect(prompt).toMatch(/e no mês seguinte/);
    expect(prompt).toMatch(/e quanto gastei\?/);
  });
  it("agradecimento, saudação e pergunta solta NÃO viram seguimento (regressão medida: 'valeu' refazia a comparação)", () => {
    expect(prompt).toMatch(/NÃO é seguimento: agradecimento, saudação, confirmação e conversa \("valeu"/);
    expect(prompt).toMatch(/pergunta solta sem marcador nem período \("quanto foi\?"/);
  });
  it("frase completa com período próprio não herda categoria nem estabelecimento", () => {
    expect(prompt).toMatch(/35l4\. FRASE COMPLETA NÃO HERDA RECORTE/);
    expect(prompt).toMatch(/Total do mês nunca pode sair com o valor de uma categoria só/);
  });
});
