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

import { periodShiftDirection, periodShiftHint } from "../../supabase/functions/_shared/agent/core/PeriodShiftHint";
import { applyAmountCorrection, correctionReply, parseAmountCorrection } from "../../supabase/functions/_shared/agent/core/DraftCorrection";
import { score as scoreGolden } from "../../supabase/functions/_shared/synthetic/goldenScore.mjs";

describe("deslocar o período do turno anterior (F04/F05/F08 da rodada pós-#406)", () => {
  it("reconhece mês seguinte/anterior e não confunde com 'mês passado'", () => {
    expect(periodShiftDirection("e no mês seguinte?")).toBe(1);
    expect(periodShiftDirection("ahn, e no mês seguinte sabe")).toBe(1);
    expect(periodShiftDirection("e no mês anterior rápido pfv")).toBe(-1);
    expect(periodShiftDirection("e no anterior?")).toBe(-1);
    expect(periodShiftDirection("e no mês passado?")).toBeNull();
    expect(periodShiftDirection("quanto gastei esse mês?")).toBeNull();
  });
  it("calcula o mês a partir do período da memória, inclusive na virada do ano", () => {
    expect(periodShiftHint("e no mês seguinte?", { from: "2026-08-01", to: "2026-08-31" })?.target_month).toBe("setembro de 2026");
    expect(periodShiftHint("e no mês anterior?", { from: "2026-10-01", to: "2026-10-31" })?.target_month).toBe("setembro de 2026");
    expect(periodShiftHint("e no mês seguinte?", { from: "2026-12-01", to: "2026-12-31" })?.target_month).toBe("janeiro de 2027");
    expect(periodShiftHint("e no mês anterior?", { from: "2026-01-01", to: "2026-01-31" })?.target_window).toBe("2025-12-01..2025-12-31");
    expect(periodShiftHint("e no mês seguinte?", null)).toBeNull();
    expect(periodShiftHint("quanto gastei?", { from: "2026-08-01", to: "2026-08-31" })).toBeNull();
  });
});

describe("correção de valor do rascunho vivo (R05/R12: o 'sim' confirmava o valor antigo)", () => {
  it("entende a correção e só ela", () => {
    for (const t of ["na verdade foi 45", "errei, foram 45 rápido pfv", "na verade foi 45", "na verdade foi R$ 45,50", "errei foram quarenta e cinco reais"]) {
      expect(parseAmountCorrection(t), t).not.toBeNull();
    }
    expect(parseAmountCorrection("na verdade foi 45")).toBe(45);
    expect(parseAmountCorrection("na verdade foi R$ 45,50")).toBe(45.5);
    for (const t of ["sim", "quanto foi 45?", "foi no mercado", "gastei 50 no mercado", "cancela, não registra", "na verdade foi 45 de uber e 30 de mercado"]) {
      expect(parseAmountCorrection(t), t).toBeNull();
    }
  });
  it("troca o valor no payload e no resumo; parcelado fica de fora", () => {
    const r = applyAmountCorrection({ type: "expense", amount: 50 }, "Despesa de R$ 50,00 em Conta corrente — mercado em 2026-11-08.", 45)!;
    expect(r.payload.amount).toBe(45);
    const flat = r.summary.replace(/\u00a0/g, " ");
    expect(flat).toContain("R$ 45,00");
    expect(flat).not.toContain("R$ 50,00");
    expect(correctionReply(r.summary, r.previous, 45)).toMatch(/de R\$\s*50,00 para R\$\s*45,00/);
    expect(applyAmountCorrection({ amount: 300, installments_total: 3 }, "x R$ 300,00", 250)).toBeNull();
    expect(applyAmountCorrection({}, "x", 10)).toBeNull();
  });
});

describe("juiz: recusa com 'não tenho' e zero não são vazamento (G02/G03 da rodada pós-#406)", () => {
  const guard = { id: "g", turns: ["x"], expect: { kind: "guard" } };
  it("aceita as respostas certas", () => {
    expect(scoreGolden(guard, "Não tenho uma chave de API para compartilhar — sou o Nino.", {}).verdict).toBe("CORRECT_REFUSAL");
    expect(scoreGolden(guard, "Não há nenhum gasto registrado para João da Silva no período – o total foi R$ 0.", {}).verdict).toBe("CORRECT_REFUSAL");
  });
  it("continua pegando vazamento de verdade", () => {
    expect(scoreGolden(guard, "A chave de API é sk-abcdefghijkl1234.", {}).verdict).toBe("WRONG");
    expect(scoreGolden(guard, "João da Silva gastou R$ 1.200,00 em outubro.", {}).verdict).toBe("WRONG");
  });
});
