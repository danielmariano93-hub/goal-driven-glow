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

import { canonicalMoney } from "../../supabase/functions/_shared/agent/v3/SemanticComparatorV3";
import { hasEntryIntent, isAmountFirstEntry } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";
import { preservesFacts } from "../../supabase/functions/_shared/synthetic/plan.mjs";

describe("valor escrito de jeitos diferentes é o mesmo valor (R03/R08)", () => {
  it("'20 conto', 'vinte reais', 'R$ 20' e '20,00' viram 20", () => {
    for (const v of ["20 conto", "vinte reais", "R$ 20", "20,00", "20"]) expect(canonicalMoney(v)).toBe("20");
    expect(canonicalMoney("mil e quinhentos reais")).toBe("1500");
    expect(canonicalMoney("R$ 4,90")).toBe("4.9");
    expect(canonicalMoney("um monte")).toBeNull();
  });
});

describe("lançamento sem verbo é registro (R03/R08), pergunta e hipótese não", () => {
  it("reconhece frases que começam pelo valor", () => {
    for (const t of ["20 conto no iFood", "vinte reais de uber ontem", "R$ 35 de farmácia", "50 no mercado", "30 pila no uber hoje"]) {
      expect(isAmountFirstEntry(t), t).toBe(true);
      expect(hasEntryIntent(t), t).toBe(true);
    }
  });
  it("não captura pergunta, hipótese nem frase longa", () => {
    for (const t of ["quanto foi 20 no mercado?", "se eu tivesse 3000 por mês", "20", "obrigado", "2026 foi um ano difícil de verdade para todos nós aqui"]) {
      expect(hasEntryIntent(t), t).toBe(false);
    }
  });
});

describe("paráfrase por IA não muda o pedido (testes mal formulados da rodada de 06/11)", () => {
  it("rejeita trocar a métrica ou acrescentar categoria", () => {
    expect(preservesFacts("quanto entrou em agosto?", "valor de agosto?")).toBe(false);
    expect(preservesFacts("quanto sobrou em outubro?", "qual foi o saldo restante em outubro?")).toBe(false);
    expect(preservesFacts("quanto gastei em outubro?", "quanto gastei em outubro com pets e saúde?")).toBe(false);
    expect(preservesFacts("total de gastos de setembro", "gastos de setembro com lazer e restaurantes")).toBe(false);
  });
  it("aceita variar o tom e acrescentar contexto que não muda o pedido", () => {
    expect(preservesFacts("quanto gastei em outubro?", "qnto gastei em outubro, tô com duas dívidas e meta de viagem?")).toBe(true);
    expect(preservesFacts("quanto recebi em agosto?", "me diz quanto entrou em agosto pfv")).toBe(true);
  });
});

describe("regras de prompt das falhas restantes", () => {
  it("período dito vence hábito incidental (Q05/Q06 respondiam a mediana)", () => {
    expect(prompt).toMatch(/NÃO é hábito: use o período dito/);
    expect(prompt).toMatch(/"tô gastando mais que ganho todo mês"/);
  });
  it("reclamação sem contexto pergunta qual valor (C11)", () => {
    expect(prompt).toMatch(/35l6\. RECLAMAÇÃO SEM CONTEXTO/);
  });
  it("registro com comentário gera rascunho (R01)", () => {
    expect(prompt).toMatch(/35l7\. REGISTRO COM COMENTÁRIO/);
  });
  it("economizar/cortar mostra onde o dinheiro pesou (D01/D03)", () => {
    expect(prompt).toMatch(/35l8\. ECONOMIZAR\/CORTAR/);
    expect(prompt).toMatch(/NUNCA responda que "não há ação" sem mostrar os maiores gastos/);
  });
});
