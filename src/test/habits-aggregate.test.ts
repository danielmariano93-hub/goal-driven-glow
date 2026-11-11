import { describe, expect, it } from "vitest";
import { aggregateAdherence, dayAggregates, rowsFor, weekdayAdherence, windowDelta } from "@/lib/habits/aggregate";
import type { HabitDef, LogRow } from "@/lib/habits/engine";

const def = (id: string, over: Partial<HabitDef> = {}): HabitDef => ({
  id, kind: "do_daily", started_on: "2026-11-01", days_of_week: null, weekly_target: null,
  quantity_target: null, quantity_period: null, rest_per_week: 1, ...over,
});
const L = (habit_id: string, local_date: string, status: LogRow["status"] = "done"): LogRow => ({ habit_id, local_date, status, quantity: null });
const today = "2026-11-10";

describe("agregação entre hábitos", () => {
  const inputs = [{ def: def("a") }, { def: def("b") }];

  it("estado do dia: completo, parcial, em branco, só folga e sem hábito previsto", () => {
    const logs = [
      L("a", "2026-11-02"), L("b", "2026-11-02"), // completo
      L("a", "2026-11-03"), // parcial (b em branco)
      L("a", "2026-11-05", "rest"), L("b", "2026-11-05", "rest"), // só folga
    ];
    const rows = rowsFor(inputs, logs, "2026-10-31", "2026-11-05", "2026-11-10");
    const agg = dayAggregates(rows, "2026-10-31", "2026-11-05", "2026-11-10");
    const by = Object.fromEntries(agg.map((a) => [a.date, a.state]));
    expect(by["2026-10-31"]).toBe("empty"); // antes do início
    expect(by["2026-11-02"]).toBe("full");
    expect(by["2026-11-03"]).toBe("partial");
    expect(by["2026-11-04"]).toBe("none");
    expect(by["2026-11-05"]).toBe("rest");
  });

  it("marca o dia de hoje e não trata o que está aberto como falha", () => {
    const rows = rowsFor(inputs, [], "2026-11-10", "2026-11-10", today);
    const [d] = dayAggregates(rows, "2026-11-10", "2026-11-10", today);
    expect(d.is_today).toBe(true);
    expect(d.state).toBe("empty");
  });

  it("adesão agregada soma todos os hábitos", () => {
    const logs = [L("a", "2026-11-08"), L("a", "2026-11-09"), L("b", "2026-11-09")];
    const rows = rowsFor(inputs, logs, "2026-11-08", "2026-11-09", today);
    // a: 2/2, b: 1/2 → 3/4
    expect(aggregateAdherence(rows, "2026-11-09", 2)).toBeCloseTo(0.75, 10);
  });

  it("hábitos semanais e de largar ficam fora do agregado diário", () => {
    const mixed = [{ def: def("a") }, { def: def("w", { kind: "do_weekly_count", weekly_target: 3 }) }, { def: def("q", { kind: "quit" }) }];
    expect([...rowsFor(mixed, [], "2026-11-01", "2026-11-09", today).keys()]).toEqual(["a"]);
  });

  it("variação contra a janela anterior só aparece com dados dos dois lados", () => {
    const a = [{ def: def("a", { started_on: "2026-10-01" }) }];
    const logs: LogRow[] = [];
    for (let i = 0; i < 7; i++) logs.push(L("a", `2026-11-0${i + 4}`)); // 04..10: 7 de 7 na janela atual
    for (const d of ["2026-10-28", "2026-10-29", "2026-10-30"]) logs.push(L("a", d)); // 3 de 7 na anterior
    const rows = rowsFor(a, logs, "2026-10-01", today, today);
    const d = windowDelta(rows, today, 7);
    expect(d.current).toBeCloseTo(1, 10);
    expect(d.delta_pp).toBe(57);
    const none = windowDelta(rowsFor([{ def: def("a", { started_on: "2026-11-05" }) }], [], "2026-11-05", today, today), today, 7);
    expect(none.delta_pp).toBeNull();
  });

  it("dia da semana só sai com amostra mínima", () => {
    const one = [{ def: def("a", { started_on: "2026-10-01" }) }];
    const logs: LogRow[] = [];
    for (let d = 1; d <= 30; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (wd !== 0 && wd !== 6) logs.push(L("a", date)); // só fazem nos dias úteis
    }
    const rows = rowsFor(one, logs, "2026-10-01", "2026-10-31", "2026-10-31");
    const w = weekdayAdherence(rows, "2026-10-31", 31, 4);
    expect(w[1].adherence).toBeCloseTo(1, 10); // segunda
    expect(w[0].adherence).toBeCloseTo(0, 10); // domingo
    const few = weekdayAdherence(rows, "2026-10-31", 10, 4);
    expect(few.some((s) => s.adherence === null)).toBe(true);
  });
});
