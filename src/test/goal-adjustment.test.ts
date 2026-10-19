import { describe, expect, it } from "vitest";
import { reviewGoalAdjustment, type GoalAdjustmentRow } from "@/lib/engine/goalAdjustment";
import type { SpendingEntry } from "@/lib/engine/spendingGoals";

const entry = (date: string, amount: number, category = "c1"): SpendingEntry => ({
  id: `${date}-${amount}`, date, month: date.slice(0, 7), category_id: category, merchant_key: "x", merchant_label: "x", amount,
});
const adj = (over: Partial<GoalAdjustmentRow> = {}): GoalAdjustmentRow => ({
  id: "a1", goal_id: "g1", category_id: "c1", adjusted_on: "2026-10-10",
  period_start: "2026-10-01", period_end: "2026-10-31", old_limit: 1000, new_limit: 1500, ...over,
});
const run = (a: GoalAdjustmentRow, entries: SpendingEntry[], today: string) =>
  reviewGoalAdjustment({ adjustment: a, entries, today, categoryName: "Lazer" });

describe("goal_adjustment.v1", () => {
  it("afrouxou e precisava: gastou entre o limite antigo e o novo", () => {
    const r = run(adj(), [entry("2026-10-05", 800), entry("2026-10-20", 500)], "2026-11-02");
    expect(r.closed).toBe(true);
    expect(r.spent).toBe(1300);
    expect(r.verdict).toBe("necessary");
    expect(r.headline).toMatch(/necessário/);
  });
  it("afrouxou sem precisar: já cabia no limite antigo", () => {
    const r = run(adj(), [entry("2026-10-05", 700)], "2026-11-02");
    expect(r.verdict).toBe("unnecessary");
  });
  it("afrouxou e mesmo assim estourou", () => {
    const r = run(adj(), [entry("2026-10-05", 1700)], "2026-11-02");
    expect(r.verdict).toBe("insufficient");
  });
  it("apertou e cumpriu", () => {
    const r = run(adj({ old_limit: 1500, new_limit: 1000 }), [entry("2026-10-05", 900)], "2026-11-02");
    expect(r.verdict).toBe("worked");
  });
  it("apertou demais: cabia no antigo, passou do novo", () => {
    const r = run(adj({ old_limit: 1500, new_limit: 1000 }), [entry("2026-10-05", 1200)], "2026-11-02");
    expect(r.verdict).toBe("too_tight");
  });
  it("só mudou a forma de medir: neutro", () => {
    const r = run(adj({ new_limit: 1000, new_baseline_kind: "prev_month" }), [entry("2026-10-05", 900)], "2026-11-02");
    expect(r.direction).toBe("measure_changed");
    expect(r.verdict).toBe("neutral");
  });
  it("período aberto: pendente, com projeção pelo ritmo e sem projetar abaixo do gasto", () => {
    const r = run(adj(), [entry("2026-10-05", 600)], "2026-10-15");
    expect(r.closed).toBe(false);
    expect(r.verdict).toBe("pending");
    expect(r.projected).toBeGreaterThanOrEqual(600);
    expect(r.leaning).not.toBeNull();
  });
  it("avisa quando o ajuste veio depois de estourar o limite antigo", () => {
    const r = run(adj(), [entry("2026-10-05", 1100), entry("2026-10-20", 100)], "2026-11-02");
    expect(r.over_at_adjustment).toBe(true);
    expect(r.explanation).toMatch(/depois de o limite antigo/);
  });
  it("ignora outra categoria e gasto fora do período", () => {
    const r = run(adj(), [entry("2026-10-05", 300), entry("2026-10-06", 5000, "c2"), entry("2026-09-30", 5000)], "2026-11-02");
    expect(r.spent).toBe(300);
  });
});
