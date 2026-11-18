import { describe, expect, it } from "vitest";
import { resolvePeriodPt } from "../../supabase/functions/_shared/analytics/periodResolver";
import { resolveMultiPeriodsPt } from "../../supabase/functions/_shared/analytics/multiPeriodResolver";
import { alignTurnPeriods } from "../../supabase/functions/_shared/agent/core/SameWindowGuard";
import { buildFinancialReadContract, validateFinancialReadContract } from "../../supabase/functions/_shared/agent/core/FinancialReadContract";

const now = new Date("2026-11-18T15:00:00Z"); // 18/11/2026
const win = (p: any) => (p ? `${p.from}..${p.to}` : null);

describe("'até hoje' fecha a janela; não é o período 'hoje'", () => {
  const monthToDate = "2026-11-01..2026-11-18";
  for (const text of ["esse mês até hoje", "quanto gastei esse mês até hoje", "gastei esse mês até hoje", "mês até agora", "esse mês até agora", "até agora", "gastei até hoje", "este mês até o momento"]) {
    it(`"${text}" → mês corrente até hoje, nos dois resolvedores`, () => {
      expect(win(resolvePeriodPt(text, now))).toBe(monthToDate);
      expect(resolveMultiPeriodsPt(text, now).periods.map(win)).toEqual([monthToDate]);
    });
  }
  it("'hoje' sozinho continua sendo o dia de hoje", () => {
    expect(win(resolvePeriodPt("quanto gastei hoje", now))).toBe("2026-11-18..2026-11-18");
  });
  for (const text of ["desde o dia 1", "a partir do dia 5", "do dia 1 até hoje"]) {
    it(`"${text}" → do dia citado até hoje`, () => {
      const day = Number(text.match(/dia (\d+)/)![1]);
      const expected = `2026-11-${String(day).padStart(2, "0")}..2026-11-18`;
      expect(win(resolvePeriodPt(text, now))).toBe(expected);
      expect(resolveMultiPeriodsPt(text, now).periods.map(win)).toEqual([expected]);
    });
  }
  it("dia depois de hoje não inventa janela", () => {
    expect(resolvePeriodPt("desde o dia 25", now)).toBeNull();
  });
  it("duas janelas na mesma frase seguem separadas ('esse mês até hoje' contra 'mês passado')", () => {
    const m = resolveMultiPeriodsPt("compara esse mês até hoje com o mês passado", now);
    expect(m.periods.map(win)).toEqual(["2026-11-01..2026-11-18", "2026-10-01..2026-10-31"]);
  });
});

describe("contrato e conta dizem a mesma janela (a trava não recusa)", () => {
  const turn: any = {
    mode: "read", domain: "financial_read", reference: null,
    focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: ["2026-10-01..2026-10-31", "2026-11-01..2026-11-18"] },
    financial_read: null,
    resolution: { intent: "resolved", reference: "not_applicable", time: "resolved", entity: "resolved" },
  };
  const ir = (cmp: [string, string]): any => ({ intent: "x", period: { from: "2026-11-01", to: "2026-11-18" }, comparison_period: { from: cmp[0], to: cmp[1] }, queries: [] });
  const raw = { from: "2026-10-01", to: "2026-10-31" };
  const aligned = { from: "2026-10-01", to: "2026-10-18" };

  it("sem alinhar o contrato, a conta alinhada é recusada (o defeito original)", () => {
    const c = buildFinancialReadContract({ turn, requested: ir(["2026-10-01", "2026-10-18"]) });
    expect(validateFinancialReadContract(c)).toContain("turn_period_vs_financial_ir_mismatch");
  });
  it("alinhando o contrato antes de montá-lo, não há divergência", () => {
    const c = buildFinancialReadContract({ turn: alignTurnPeriods(turn, raw, aligned), requested: ir(["2026-10-01", "2026-10-18"]) });
    expect(validateFinancialReadContract(c)).toEqual([]);
  });
  it("sem janela alinhada, o turno segue idêntico", () => {
    expect(alignTurnPeriods(turn, raw, null)).toBe(turn);
  });
});
