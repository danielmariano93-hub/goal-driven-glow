import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Falhas achadas pelos usuários sintéticos viram regra permanente no interpretador semântico.
const prompt = readFileSync("supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts", "utf8");

describe("regras nascidas de falhas dos usuários sintéticos", () => {
  it("'quanto sobrou' em período passado é balanço do período, não total gasto nem patrimônio", () => {
    expect(prompt).toMatch(/35l2\..*Quanto sobrou em outubro.*period_review/s);
    expect(prompt).toMatch(/NUNCA responda só o total gasto nem o patrimônio/);
  });
  it("seguimento elíptico troca só a métrica ou desloca só o período", () => {
    expect(prompt).toMatch(/35l3\. SEGUIMENTO ELÍPTICO/);
    expect(prompt).toMatch(/e no mês seguinte/);
    expect(prompt).toMatch(/e quanto gastei\?/);
  });
});
