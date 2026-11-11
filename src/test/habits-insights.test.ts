import { describe, expect, it } from "vitest";
import { mergeAutoLogs, moneyInsight, reviewText, weekPoints, weeklyReview, type HabitDef, type LogRow, type WeekPoint } from "@/lib/habits/engine";

const def: HabitDef = { id: "h", kind: "do_daily", started_on: "2026-09-01", days_of_week: null, weekly_target: null, quantity_target: null, quantity_period: null, rest_per_week: 1 };
const L = (d: string, status: LogRow["status"] = "done"): LogRow => ({ habit_id: "h", local_date: d, status, quantity: null });

describe("marcações medidas", () => {
  it("a marcação manual sempre vale mais que a medida", () => {
    const merged = mergeAutoLogs([L("2026-11-02", "done")], [{ ...L("2026-11-02", "skipped"), source: "auto" }, { ...L("2026-11-03", "done"), source: "auto" }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((l) => l.local_date === "2026-11-02")?.status).toBe("done");
    expect(merged.find((l) => l.local_date === "2026-11-03")?.status).toBe("done");
  });
});

describe("revisão semanal", () => {
  it("conta a semana corrente contra a anterior", () => {
    // hoje = domingo 2026-11-08; semana: 02..08; anterior: 26/10..01/11
    const logs = [L("2026-11-02"), L("2026-11-03"), L("2026-11-04"), L("2026-11-05"), L("2026-10-27"), L("2026-10-28")];
    const r = weeklyReview([{ def }], logs, "2026-11-08");
    expect(r[0]).toMatchObject({ done: 4, expected: 7, prev_done: 2, prev_expected: 7 });
    const t = reviewText(r, () => "Meditar");
    expect(t).toContain("Meditar: 4 de 7 dias.");
    expect(t).toContain("Melhor que a semana passada.");
    expect(t).not.toMatch(/falh|culpa|ruim/i);
  });
});

describe("régua dos insights de dinheiro", () => {
  const wk = (n: number, adherence: number | null, spent: number): WeekPoint => ({ week_start: `w${n}`, adherence, spent });
  it("amostra pequena nunca vira insight", () => {
    const r = moneyInsight([wk(1, 0.9, 50), wk(2, 0.2, 200), wk(3, 0.9, 40)]);
    expect(r.status).toBe("insufficient");
    expect(r).toMatchObject({ needed: 5 });
  });
  it("8 semanas mas poucas em um dos grupos também não fala", () => {
    const pts = [...Array.from({ length: 7 }, (_, i) => wk(i, 0.9, 50)), wk(9, 0.1, 300)];
    expect(moneyInsight(pts)).toMatchObject({ status: "insufficient", reason: "groups" });
  });
  it("diferença clara com amostra suficiente vira insight", () => {
    const pts = [...Array.from({ length: 4 }, (_, i) => wk(i, 0.9, 50)), ...Array.from({ length: 4 }, (_, i) => wk(10 + i, 0.3, 150))];
    const r = moneyInsight(pts);
    expect(r).toMatchObject({ status: "ok", diff: 100, high_n: 4, low_n: 4 });
  });
  it("diferença pequena não é insight", () => {
    const pts = [...Array.from({ length: 4 }, (_, i) => wk(i, 0.9, 100)), ...Array.from({ length: 4 }, (_, i) => wk(10 + i, 0.3, 105))];
    expect(moneyInsight(pts).status).toBe("no_difference");
  });
  it("semanas sem adesão calculável ficam fora", () => {
    expect(moneyInsight(Array.from({ length: 10 }, (_, i) => wk(i, null, 10))).status).toBe("insufficient");
  });
  it("weekPoints liga adesão e gasto por semana", () => {
    const pts = weekPoints(def, [L("2026-11-02"), L("2026-11-03")], "2026-11-16", [{ week_start: "2026-11-02", spent: 80 }]);
    expect(pts[0]).toMatchObject({ week_start: "2026-11-02", spent: 80 });
    expect(pts[0].adherence).toBeCloseTo(2 / 7, 5);
  });
});
