import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_RESULT_WORDS,
  NET_WORTH_DEFINITION,
  resultHeadline,
  resultSentence,
  resultShape,
} from "@/lib/copy/resultWording";

const cases: Array<[number, number]> = [
  [5000, 7000],
  [0, 1200],
  [8000, 3000],
  [4000, 4000],
];

describe("vocabulário de resultado", () => {
  it("nunca usa termos proibidos", () => {
    for (const [income, expense] of cases) {
      const text = `${resultHeadline(income, expense)} ${resultSentence(income, expense)}`.toLowerCase();
      for (const word of FORBIDDEN_RESULT_WORDS) {
        expect(text).not.toContain(word);
      }
    }
  });

  it("descreve gasto acima da receita em valor absoluto", () => {
    expect(resultShape(5000, 7000)).toBe("gap");
    expect(resultHeadline(5000, 7000)).toContain("acima do que recebeu");
    expect(resultHeadline(5000, 7000)).not.toContain("-R$");
  });

  it("define patrimônio líquido já descontando obrigações", () => {
    expect(NET_WORTH_DEFINITION).toContain("fatura em aberto");
    expect(NET_WORTH_DEFINITION).toContain("outras dívidas");
  });
});
