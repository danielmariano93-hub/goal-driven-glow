// Intervalo de meses nomeados no resolvedor de período (`period_month_range.v1`).
// Regressão do piloto de 29/10: "de junho a setembro" resolvia só junho.
import { describe, expect, it } from "vitest";
import { resolvePeriodPt, resolveTimeAspectPt } from "../../supabase/functions/_shared/analytics/periodResolver";

const NOW = new Date("2026-10-29T12:00:00Z");

describe("intervalo de meses", () => {
  it.each([
    ["gastos de junho a setembro", "2026-06-01", "2026-09-30"],
    ["de junho até setembro", "2026-06-01", "2026-09-30"],
    ["entre junho e setembro", "2026-06-01", "2026-09-30"],
    ["junho a setembro de 2026", "2026-06-01", "2026-09-30"],
    ["de agosto a outubro", "2026-08-01", "2026-10-29"],
    ["de novembro a janeiro", "2025-11-01", "2026-01-31"],
  ])("%s", (text, from, to) => {
    const p = resolvePeriodPt(text, NOW)!;
    expect([p.from, p.to]).toEqual([from, to]);
  });

  it("mês isolado continua igual", () => {
    expect(resolvePeriodPt("gastos em setembro", NOW)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("'julho e setembro' são dois meses, não o intervalo julho–setembro", () => {
    const p = resolvePeriodPt("gastos de julho e setembro", NOW)!;
    expect(p.kind).toBe("month");
  });
});

describe("aspecto com janela explícita", () => {
  it("'por mês de junho a setembro' é série dessa janela, não hábito de 6 meses", () => {
    const a = resolveTimeAspectPt("gastos no Uber por mês de junho a setembro", NOW);
    expect(a).toMatchObject({ aspect: "trend", from: "2026-06-01", to: "2026-09-30", grain: "month", reduce: "none" });
  });

  it("'mês a mês de junho a setembro' usa a janela inteira", () => {
    const a = resolveTimeAspectPt("gastos no Uber mês a mês de junho a setembro", NOW);
    expect(a).toMatchObject({ aspect: "trend", from: "2026-06-01", to: "2026-09-30" });
  });

  it("sem janela explícita, 'por mês' continua sendo hábito", () => {
    const a = resolveTimeAspectPt("quanto gasto por mês com alimentação?", NOW);
    expect(a.aspect).toBe("habitual");
  });
});
