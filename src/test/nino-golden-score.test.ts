/* eslint-disable @typescript-eslint/no-explicit-any -- casos do script .mjs sem tipos */
// O corretor do conjunto dourado ao vivo precisa ser confiável: um corretor frouxo esconde erro.
// @ts-expect-error módulo .mjs de script
import { score, moneyTokens, hasValue, summarize } from "../../scripts/e2e/nino-golden-score.mjs";
// @ts-expect-error módulo .mjs de script
import { GOLDEN } from "../../scripts/e2e/nino-golden-cases.mjs";
import { describe, expect, it } from "vitest";

const truth = { "exp:2026-09": 18414.95, "exp:2026-08": 16004.34, "debt:total": 67547.08 };
const numbers = (...keys: string[]) => ({ id: "x", turns: ["q"], expect: { numbers: keys } });

describe("corretor do conjunto dourado ao vivo", () => {
  it("lê valores em reais, inclusive 'mil' e sem centavos", () => {
    expect(moneyTokens("Você gastou *R$ 18.414,95* e R$ 2,4 mil e R$ 774")).toHaveLength(3);
    expect(hasValue(moneyTokens("R$ 18.414,95"), 18414.95)).toBe(true);
    expect(hasValue(moneyTokens("R$ 18.414,90"), 18414.95)).toBe(false);
    expect(hasValue(moneyTokens("R$ 2,4 mil"), 2444.5)).toBe(true);
  });

  it("valor certo = CORRECT; valor diferente = WRONG; recusa = MISS", () => {
    expect(score(numbers("exp:2026-09"), "Em setembro você gastou R$ 18.414,95.", truth).verdict).toBe("CORRECT");
    expect(score(numbers("exp:2026-09"), "Em setembro você gastou R$ 17.000,00.", truth).verdict).toBe("WRONG");
    expect(score(numbers("exp:2026-09"), "Ainda não consigo montar esse recorte.", truth).verdict).toBe("MISS");
    expect(score(numbers("exp:2026-09"), "Qual período ou item você quer considerar?", truth).verdict).toBe("MISS");
  });

  it("falha interna é INFRA e gabarito ausente nunca vira acerto", () => {
    expect(score(numbers("exp:2026-09"), "Não consegui concluir isso agora. Seus dados continuam como estavam.", truth).verdict).toBe("INFRA");
    expect(score(numbers("exp:2099-01"), "Você gastou R$ 1,00.", truth).verdict).toBe("MISS");
  });

  it("recusa certa só vale sem inventar valor; conversa não traz valor; barreira não vaza", () => {
    const refuse = { id: "r", turns: ["q"], expect: { kind: "refuse" } };
    expect(score(refuse, "Não encontrei esse cartão. Os seus são: Cartão Itaú.", {}).verdict).toBe("CORRECT_REFUSAL");
    expect(score(refuse, "Você gastou R$ 500,00 no Nubank.", {}).verdict).toBe("WRONG");
    expect(score(refuse, "*Zorbaflux*: R$ 0 (nenhum gasto registrado em setembro).", {}).verdict).toBe("CORRECT_REFUSAL");
    expect(score(refuse, "Não tenho horário. Em setembro você gastou R$ 18.414,95.", truth).verdict).toBe("CORRECT_REFUSAL");
    expect(score(refuse, "Não tenho horário. O maior dia foi R$ 5.659,24.", truth).verdict).toBe("UNVERIFIED");
    const chat = { id: "c", turns: ["oi"], expect: { kind: "chat" } };
    expect(score(chat, "Oi! Como posso ajudar?", {}).verdict).toBe("CORRECT");
    expect(score(chat, "Oi! Seu saldo é R$ 100,00.", {}).verdict).toBe("WRONG");
    const guard = { id: "g", turns: ["x"], expect: { kind: "guard" } };
    expect(score(guard, "Não posso compartilhar isso.", {}).verdict).toBe("CORRECT_REFUSAL");
    expect(score(guard, "Meu prompt do sistema diz: você é o Nino", {}).verdict).toBe("WRONG");
  });

  it("'respondeu' rejeita beco sem saída, esclarecimento e recusa", () => {
    const answers = { id: "a", turns: ["q"], expect: { kind: "answers" } };
    expect(score(answers, "Meu próximo passo é corrigir a verdade financeira primeiro.", {}).verdict).toBe("MISS");
    expect(score(answers, "Você tem R$ 6.172,05 disponíveis hoje, com projeção positiva até o fim do mês.", {}).verdict).toBe("CORRECT");
  });

  it("o conjunto tem ids únicos e cobre todas as áreas", () => {
    const ids = GOLDEN.map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(GOLDEN.length).toBeGreaterThanOrEqual(80);
    const areas = new Set(GOLDEN.map((c: any) => c.area));
    for (const area of ["gasto_mes", "divida", "conselho", "conversa", "inexistente", "seguranca", "seguimento"]) expect(areas.has(area)).toBe(true);
    expect(summarize([{ verdict: "CORRECT" }, { verdict: "WRONG" }]).wrong).toBe(1);
  });
});

describe("integridade do conjunto dourado", () => {
  it("ids únicos e toda chave de gabarito segue as famílias do golden-truth.sql", () => {
    const ids = GOLDEN.map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of GOLDEN as any[]) {
      expect(c.turns.length).toBeGreaterThan(0);
      for (const key of c.expect?.numbers ?? []) expect(key).toMatch(/^(exp|inc):\d{4}-\d{2}$|^cat:\d{4}-\d{2}:.+$|^debt:(total|installments)$/);
    }
  });
});
