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
  it("muletas de áudio/pressa não escondem o seguimento nem viram consulta (regressão F04/C09/C10)", () => {
    expect(prompt).toMatch(/IGNORE interjeições e muletas no começo e no fim/);
    expect(prompt).toMatch(/"ahn, e no mês seguinte sabe" É seguimento/);
    expect(prompt).toMatch(/"e aí rápido pfv"/);
    expect(prompt).toMatch(/"ahn, quanto foi sabe"/);
  });
  it("contexto incidental na frase não vira filtro nem pergunta (regressão Q03: 'qual meta?')", () => {
    expect(prompt).toMatch(/35l5\. CONTEXTO INCIDENTAL NÃO É O PEDIDO/);
    expect(prompt).toMatch(/NÃO viram filtro nem pedem esclarecimento \("qual meta\?"\)/);
  });
  it("frase completa com período próprio não herda categoria nem estabelecimento", () => {
    expect(prompt).toMatch(/35l4\. FRASE COMPLETA NÃO HERDA RECORTE/);
    expect(prompt).toMatch(/Total do mês nunca pode sair com o valor de uma categoria só/);
  });
});

import { writeDisagreementQuestion } from "../../supabase/functions/_shared/agent/core/ConversationAuthority";

describe("pergunta quando as leituras divergem num registro (R02–R05)", () => {
  it("usa o valor que a pessoa já disse", () => {
    expect(writeDisagreementQuestion("20 conto no iFood")).toMatch(/R\$\s*20,00/);
    expect(writeDisagreementQuestion("Paguei R$120 de luz ontem.")).toMatch(/R\$\s*120,00/);
    expect(writeDisagreementQuestion("gastei 4,90 no pão")).toMatch(/R\$\s*4,90/);
  });
  it("um 'sim' solto recebe resposta honesta, não a pergunta genérica", () => {
    expect(writeDisagreementQuestion("sim")).toMatch(/ligar o seu “sim”/);
    expect(writeDisagreementQuestion("pode")).toMatch(/ligar o seu “sim”/);
  });
  it("sem valor, mantém a pergunta genérica", () => {
    expect(writeDisagreementQuestion("anota aí")).toMatch(/Quero registrar certinho/);
  });
});
