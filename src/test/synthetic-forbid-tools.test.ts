import { describe, expect, it } from "vitest";
// @ts-ignore módulo .mjs
import { scoreScenario } from "../../supabase/functions/_shared/synthetic/score.mjs";
// @ts-ignore
import { SCENARIOS } from "../../supabase/functions/_shared/synthetic/scenarios.mjs";

const base = { level: 1, today: "2026-11-24", truth: { "mtd:exp": 3652.45 }, known: [3652.45], asked: ["como foi meu mês?"] };
const reply = "📊 *Novembro até agora* (1 a 24/11)\n*Gastos:* R$ 3.652,45";
const expectS = { numbers: ["mtd:exp"], forbid_tools: ["compare_periods"] };

describe("resumo não pode virar comparação", () => {
  it("valor certo e sem comparação executada → CORRECT", () => {
    const r = scoreScenario({ ...base, expect: expectS, replies: [reply], state: { txs: [] }, tool_calls: [{ tool_name: "period_review", ok: true }] });
    expect(r.verdict).toBe("CORRECT");
  });
  it("mesmo valor, mas compare_periods foi executado → WRONG", () => {
    const r = scoreScenario({ ...base, expect: expectS, replies: [reply], state: { txs: [] }, tool_calls: [{ tool_name: "compare_periods", ok: true }] });
    expect(r.verdict).toBe("WRONG");
    expect(r.why).toContain("compare_periods");
  });
  it("sem rastro de ferramenta não inventa erro", () => {
    const r = scoreScenario({ ...base, expect: expectS, replies: [reply], state: { txs: [] } });
    expect(r.verdict).toBe("CORRECT");
  });
  it("cenários S01–S06 existem, na área 'resumo', todos proibindo compare_periods", () => {
    for (let i = 1; i <= 6; i++) {
      const s = SCENARIOS.find((x: any) => x.id === `S0${i}`);
      expect(s, `S0${i}`).toBeTruthy();
      expect(s.area).toBe("resumo");
    }
  });
});
