import { describe, it, expect } from "vitest";
import { buildGoalHistory } from "@/lib/engine/goalHistory";
import { goalCyclesFromHistory } from "@/lib/behavioral/goalCyclesFromHistory";
import { cycleSentence } from "@/lib/engine/behaviorObserved";
import { buildObservedProfileV3 } from "@/lib/engine/behaviorObservedV3";

// Caso real: ciclos guardados só de ago/set (todos estourados) + meta viva "este mês" de setembro que foi cumprida.
const history = buildGoalHistory({
  today: "2026-10-16",
  categories: [{ id: "alim", name: "Alimentação" }, { id: "laz", name: "Lazer" }],
  entries: [
    { id: "1", date: "2026-08-10", month: "2026-08", category_id: "alim", merchant_key: "a", merchant_label: "A", amount: 1317 },
    { id: "2", date: "2026-09-10", month: "2026-09", category_id: "alim", merchant_key: "a", merchant_label: "A", amount: 670.92 },
    { id: "3", date: "2026-09-10", month: "2026-09", category_id: "laz", merchant_key: "b", merchant_label: "B", amount: 2830 },
  ] as never,
  goals: [{ id: "g1", category_id: "alim", computed_limit: 714.77, start_date: "2026-09-01", end_date: "2026-09-30", period_type: "this_month", status: "active" }] as never,
  cycles: [
    { id: "c1", category_id: "alim", computed_limit: 695.51, start_date: "2026-08-01", end_date: "2026-08-31", period_type: "custom", status: "active" },
    { id: "c2", category_id: "laz", computed_limit: 1272.79, start_date: "2026-09-01", end_date: "2026-09-30", period_type: "custom", status: "active" },
  ] as never,
  current: {},
} as never);

describe("Hábitos usa as mesmas metas da tela de Metas", () => {
  it("conta a meta de setembro cumprida, mesmo sem ciclo guardado", () => {
    const cycles = goalCyclesFromHistory(history);
    expect(cycles).toHaveLength(3);
    expect(cycles.filter((c) => Number(c.actual_spend) <= Number(c.target_snapshot))).toHaveLength(1);
  });

  it("o painel de Controle diz 1 de 3, não 0", () => {
    const p = buildObservedProfileV3({
      financialRow: { payload: { snapshot: { activeCategoryGoals: [] } } }, checkins: [], txStats: { count: 300, first_at: "2026-05-01T00:00:00Z" },
      appActivity: {}, goalCycles: goalCyclesFromHistory(history), planningStats: { active_category_goals: 1, active_recurring_rules: 0 }, investmentStats: {},
    } as never, new Date("2026-10-16T12:00:00Z").getTime());
    const text = (p.dimensions.control.record?.observed ?? []).join(" ");
    expect(text).toContain("Você cumpriu 1 de 3 metas mensais que já terminaram.");
  });
});

describe("frase das metas mensais (plural correto)", () => {
  it.each([
    [0, 6, "Você não cumpriu nenhuma das 6 metas mensais que já terminaram."],
    [1, 8, "Você cumpriu 1 de 8 metas mensais que já terminaram."],
    [3, 3, "Você cumpriu todas as 3 metas mensais que já terminaram."],
    [0, 1, "Você não cumpriu a única meta mensal que já terminou."],
    [1, 1, "Você cumpriu a única meta mensal que já terminou."],
  ])("%i de %i", (hit, total, expected) => expect(cycleSentence(hit, total)).toBe(expected));
});

describe("Patrimônio considera resgates (caso real: aplicou 8.000, resgatou 10.601)", () => {
  it("fala em valor investido que caiu e não pontua a taxa de aporte", () => {
    const p = buildObservedProfileV3({
      financialRow: { payload: { snapshot: { monthlyTotals: { income: 3000, expense: 2000 } } } }, checkins: [], txStats: { count: 300, first_at: "2026-05-01T00:00:00Z" },
      appActivity: {}, goalCycles: [], planningStats: {}, investmentStats: { contributions_90d: 8000, redemptions_90d: 10601.81, contribution_days_90d: 1 },
    } as never, new Date("2026-10-16T12:00:00Z").getTime());
    const w = p.dimensions.wealth.record!;
    expect(w.observed.join(" ")).toMatch(/resgatou .*mais do que investiu.*caiu/);
    expect((p.dimensions.wealth as { evidence?: string }).evidence).toMatch(/o valor investido caiu/);
  });
});
