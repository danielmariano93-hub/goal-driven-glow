import { describe, expect, it } from "vitest";
import { buildGoalHistory, type HistoryGoalRow } from "@/lib/engine/goalHistory";
import { buildSpendingLedger, type SpendingLedgerTx } from "@/lib/engine/spendingGoals";

const T = "cat-transporte";
const L = "cat-lazer";
let seq = 0;
const tx = (occurred_at: string, amount: number, merchant_name: string, category_id = T): SpendingLedgerTx => ({
  id: `h${++seq}`, account_id: "a", category_id, type: "expense", status: "confirmed", amount, occurred_at,
  description: merchant_name, merchant_name, transfer_group_id: null, movement_kind: "transaction",
} as SpendingLedgerTx);

const goal = (over: Partial<HistoryGoalRow> & Pick<HistoryGoalRow, "id" | "start_date">): HistoryGoalRow => ({
  category_id: T, computed_limit: 1000, status: "active", period_type: "this_month", end_date: null, ...over,
});

const categories = [{ id: T, name: "Transporte" }, { id: L, name: "Lazer" }];

describe("histórico das metas como série por categoria", () => {
  // Caso real: metas avulsas de setembro e de outubro na mesma categoria.
  const rows = [
    tx("2026-06-10", 1500, "Uber"), tx("2026-07-10", 1700, "Uber"), tx("2026-08-10", 1900, "Uber"),
    tx("2026-09-05", 1500, "Uber"), tx("2026-09-20", 647.49, "99"),
    tx("2026-10-01", 50, "Uber"),
  ];
  const goals = [
    goal({ id: "set", start_date: "2026-09-01", end_date: "2026-09-30", computed_limit: 1222.86, created_at: "2026-09-02" }),
    goal({ id: "out", start_date: "2026-10-01", end_date: "2026-10-31", computed_limit: 846.36, created_at: "2026-10-01" }),
  ];
  const history = buildGoalHistory({
    today: "2026-10-01", goals, entries: buildSpendingLedger(rows), categories,
    current: { out: { projected: 955.75, status: "at_risk" } },
  });
  const s = history.series[0];

  it("costura setembro e outubro na mesma série, com 3 meses de referência antes", () => {
    expect(history.series).toHaveLength(1);
    expect(s.months.map((m) => [m.month, m.status])).toEqual([
      ["2026-06", "before"], ["2026-07", "before"], ["2026-08", "before"],
      ["2026-09", "missed"], ["2026-10", "in_progress"],
    ]);
    expect(s.months[3]).toMatchObject({ goal_id: "set", limit: 1222.86, actual: 2147.49 });
    expect(s.months[3].main_driver?.label).toBe("Uber");
    expect(s.months[4]).toMatchObject({ goal_id: "out", projected: 955.75 });
    expect(s.current_goal_id).toBe("out");
  });

  it("referência é a média de antes da meta e mede se reduziu ou aumentou", () => {
    expect(s.baseline).toBe(1700);
    expect(s.kpis).toMatchObject({ closed_months: 1, met_months: 0, streak: 0, savings_total: -447.49 });
    expect(s.kpis.change_vs_baseline).toBeCloseTo(0.26, 2);
    expect(s.kpis.direction).toBe("up");
  });

  it("placar mostra os últimos 6 meses", () => {
    expect(history.scoreboard.months).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(history.scoreboard.rows[0].cells.map((c) => c.status)).toEqual(["no_goal", "before", "before", "before", "missed", "in_progress"]);
  });

  it("highlights explicam piora e resultado acumulado", () => {
    const titles = history.highlights.map((h) => h.title);
    expect(titles).toContain("Transporte subiu 26%");
    expect(titles).toContain("Transporte fechou setembro acima");
    // Sem categoria abaixo da média de antes: não há destaque de "impacto" (e nunca uma frase de que a meta piorou).
    expect(history.highlights.some((h) => h.id === "impact")).toBe(false);
    expect(history.impact.estimated_savings).toBeLessThan(0);
    expect(history.impact.reduced_total).toBe(0);
  });

  it("meta recorrente: sequência, economia e queda frente à referência", () => {
    const r = [
      tx("2026-05-10", 1000, "Bar", L), tx("2026-06-10", 1000, "Bar", L),
      tx("2026-07-10", 700, "Bar", L), tx("2026-08-10", 650, "Show", L), tx("2026-09-10", 600, "Bar", L),
    ];
    const h = buildGoalHistory({
      today: "2026-10-05",
      goals: [goal({ id: "rec", category_id: L, start_date: "2026-07-01", period_type: "monthly_recurring", computed_limit: 800, baseline_value: 1000 })],
      entries: buildSpendingLedger(r), categories,
    });
    const lazer = h.series[0];
    expect(lazer.months.filter((m) => m.goal_id).map((m) => m.status)).toEqual(["met", "met", "met", "in_progress"]);
    expect(lazer.kpis).toMatchObject({ met_months: 3, streak: 3, savings_total: 1050, direction: "down" });
    const titles = h.highlights.map((x) => x.title);
    expect(titles).toContain("Lazer caiu 35%");
    expect(titles).toContain("Lazer: 3 meses seguidos na meta");
    expect(h.impact.estimated_savings).toBe(1050);
    expect(h.highlights[0].title).toMatch(/^Em Lazer você gastou R\$\s1\.050,00 a menos do que antes da meta$/);
  });

  it("sem mês fechado ainda: avisa quando sai o primeiro fechamento", () => {
    const h = buildGoalHistory({
      today: "2026-10-05",
      goals: [goal({ id: "x", start_date: "2026-10-01", end_date: "2026-10-31" })],
      entries: [], categories,
    });
    expect(h.highlights.map((x) => x.id)).toContain("first_close");
  });

  it("meses guardados no histórico voltam quando a meta foi editada ou excluída", () => {
    const r = [tx("2026-07-10", 900, "Uber"), tx("2026-08-10", 800, "Uber"), tx("2026-09-10", 1300, "Uber"), tx("2026-09-12", 500, "Bar", L), tx("2026-08-12", 400, "Bar", L)];
    const h = buildGoalHistory({
      today: "2026-10-01", entries: buildSpendingLedger(r), categories,
      // Transporte: a meta de agosto foi editada para setembro (viva) e agosto ficou guardado.
      goals: [goal({ id: "live", start_date: "2026-09-01", end_date: "2026-09-30", computed_limit: 1222.86 })],
      cycles: [
        goal({ id: "c-ago-t", start_date: "2026-08-01", end_date: "2026-08-31", computed_limit: 824.98 }),
        // Lazer: meta excluída, só existe no histórico.
        goal({ id: "c-ago-l", category_id: L, start_date: "2026-08-01", end_date: "2026-08-31", computed_limit: 668.01 }),
        goal({ id: "c-set-l", category_id: L, start_date: "2026-09-01", end_date: "2026-09-30", computed_limit: 1272.79 }),
      ],
    });
    const t = h.series.find((s) => s.category_id === T)!;
    const l = h.series.find((s) => s.category_id === L)!;
    expect(t.months.filter((m) => m.goal_id).map((m) => [m.month, m.status, m.limit])).toEqual([
      ["2026-08", "met", 824.98], ["2026-09", "missed", 1222.86], ["2026-10", "no_goal", null],
    ].filter((x) => x[2] !== null));
    expect(l.months.filter((m) => m.goal_id).map((m) => [m.month, m.status])).toEqual([["2026-08", "met"], ["2026-09", "met"]]);
  });

  it("impacto: referência fixa × gasto fechado; a variação das categorias sem meta é só contexto", () => {
    const M = "cat-mercado";
    const r = [
      // Transporte (com meta a partir de julho): 1000/mês antes, 700 depois.
      tx("2026-04-10", 1000, "Uber"), tx("2026-05-10", 1000, "Uber"), tx("2026-06-10", 1000, "Uber"),
      tx("2026-07-10", 700, "Uber"), tx("2026-08-10", 700, "Uber"),
      // Mercado (sem meta): subiu 10% no mesmo período.
      tx("2026-04-10", 500, "Extra", M), tx("2026-05-10", 500, "Extra", M), tx("2026-06-10", 500, "Extra", M),
      tx("2026-07-10", 550, "Extra", M), tx("2026-08-10", 550, "Extra", M),
    ];
    const h = buildGoalHistory({
      today: "2026-09-05", entries: buildSpendingLedger(r), alertsDelivered: 4,
      categories: [...categories, { id: M, name: "Mercado" }],
      goals: [goal({ id: "g", start_date: "2026-07-01", period_type: "monthly_recurring", computed_limit: 800 })],
    });
    expect(h.impact.control_change).toBe(0.1);
    expect(h.impact.expected_without_goals).toBe(2000); // 2 meses × 1000 (não é escalado pelos +10%)
    expect(h.impact.actual_with_goals).toBe(1400);
    expect(h.impact.estimated_savings).toBe(600);
    expect(h.impact.alerts_delivered).toBe(4);
    expect(h.impact.explanation).toContain("subiram 10%");
    expect(h.impact.explanation).toContain("não uma previsão");
  });

  it("conjunto levemente acima da média de antes não vira 'a meta piorou': mostra onde reduziu e não prevê o 'sem meta'", () => {
    const A = "cat-alim";
    const r = [
      // Transporte: referência 1000, gastou 1100 (acima). Alimentação: referência 1000, gastou 600 (abaixo).
      tx("2026-08-10", 1100, "Uber"), tx("2026-09-10", 1100, "Uber"),
      tx("2026-08-11", 600, "Padaria", A), tx("2026-09-11", 600, "Padaria", A),
    ];
    const h = buildGoalHistory({
      today: "2026-10-05", entries: buildSpendingLedger(r),
      categories: [...categories, { id: A, name: "Alimentação" }],
      goals: [
        goal({ id: "t", start_date: "2026-08-01", period_type: "monthly_recurring", computed_limit: 900, baseline_value: 1000 }),
        goal({ id: "a", category_id: A, start_date: "2026-08-01", period_type: "monthly_recurring", computed_limit: 800, baseline_value: 1000 }),
      ],
    });
    const i = h.impact;
    expect(i.estimated_savings).toBe(600); // conjunto: 4000 de referência × 3400 gastos; Transporte −200, Alimentação +800
    expect(i.reduced_total).toBe(800);
    expect(i.reduced_categories).toBe(1);
    expect(i.headline).toMatch(/^Em Alimentação você gastou R\$\s800,00 a menos do que antes da meta$/);
    const text = `${i.headline} ${i.explanation}`;
    expect(text).not.toMatch(/provavelmente|sem meta, você|evitaram|acima do esperado/i);
    expect(h.highlights[0].tone).toBe("positive");
  });

  it("o número não muda quando meses antigos são importados ou recategorizados depois", () => {
    const base = [tx("2026-07-10", 700, "Uber"), tx("2026-08-10", 700, "Uber")];
    const goals = [goal({ id: "g", start_date: "2026-07-01", period_type: "monthly_recurring", computed_limit: 800, baseline_value: 1000 })];
    const run = (rows: SpendingLedgerTx[]) => buildGoalHistory({ today: "2026-09-05", entries: buildSpendingLedger(rows), categories, goals }).impact;
    const before = run(base);
    // Depois: a pessoa importa abril–junho (valores quaisquer) e uma categoria sem meta ganha lançamentos antigos.
    const after = run([
      ...base,
      tx("2026-04-10", 3000, "Uber"), tx("2026-05-10", 90, "Uber"), tx("2026-06-10", 4000, "Uber"),
      tx("2026-05-12", 900, "Cinema", L),
    ]);
    expect(before.estimated_savings).toBe(600);
    expect(after.estimated_savings).toBe(before.estimated_savings);
    expect(after.expected_without_goals).toBe(before.expected_without_goals);
  });
});
