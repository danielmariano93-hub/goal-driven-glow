import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolvePeriodPt } from "../../supabase/functions/_shared/analytics/periodResolver";
import { asksWholeMonth, sameWindowComparison } from "../../supabase/functions/_shared/agent/core/SameWindowGuard";

const now = new Date("2026-11-24T15:00:00Z");
const win = (p: any) => (p ? `${p.from}..${p.to}` : null);

describe("vocabulário fechado de tempo na comparação: o código calcula as datas", () => {
  it("'este mês até hoje' → mês corrente até hoje", () => {
    expect(win(resolvePeriodPt("este mês até hoje", now))).toBe("2026-11-01..2026-11-24");
  });
  for (const text of ["mesmos dias do mês anterior", "mesmos dias do mês passado", "mesmo período do mês passado", "mesmo período do mês anterior"]) {
    it(`"${text}" → 01/10 a 24/10`, () => {
      expect(win(resolvePeriodPt(text, now))).toBe("2026-10-01..2026-10-24");
    });
  }
  it("'mês anterior inteiro' → outubro fechado", () => {
    expect(win(resolvePeriodPt("mês anterior inteiro", now))).toBe("2026-10-01..2026-10-31");
  });
  it("mês anterior mais curto limita ao último dia (31/03 → fevereiro)", () => {
    expect(win(resolvePeriodPt("mesmos dias do mês anterior", new Date("2026-03-31T15:00:00Z")))).toBe("2026-02-01..2026-02-28");
  });
});

describe("pedido do mês fechado tolera erro de digitação", () => {
  for (const t of ["outubro inteiro", "outubro ineiro", "mes anterior copleto", "mes anterior completo", "o mes todo", "fechado"]) {
    it(`"${t}" pede o mês fechado`, () => expect(asksWholeMonth(t)).toBe(true));
  }
  for (const t of ["mesmo periodo do mes anterior", "tô gastando mais que no mês passado até aogra", "como estou esse mes comprado com o mes anterior"]) {
    it(`"${t}" não pede`, () => expect(asksWholeMonth(t)).toBe(false));
  }
  it("a trava não alinha quando o 'inteiro' veio com erro de digitação", () => {
    const base = { from: "2026-11-01", to: "2026-11-24" };
    const full = { from: "2026-10-01", to: "2026-10-31" };
    expect(sameWindowComparison("copmara o que gasei esse mês até agora com outubro ineiro", base, full)).toBeNull();
    expect(sameWindowComparison("tô gastando mais ou menos que no mês psasado", base, full)).toEqual({ from: "2026-10-01", to: "2026-10-24" });
  });
});

describe("o prompt do interpretador fixa o vocabulário fechado (spec) e a prioridade sobre o resumo", () => {
  const src = readFileSync("supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts", "utf8");
  it("pede spec em todo período, lista o vocabulário e proíbe o modelo de escrever datas", () => {
    expect(src).toContain("PERÍODOS COM SPEC FECHADO");
    for (const k of ["same_days_previous_month", "calendar_month", "rolling_days", "previous_rolling_days", "day_range", "since_day", "explicit_range"]) expect(src).toContain(k);
    expect(src).toContain("NUNCA escreve datas");
  });
  it("mantém a prioridade da comparação sobre o resumo (35b)", () => {
    expect(src).toContain("TEM PRIORIDADE sobre 35b");
  });
});
