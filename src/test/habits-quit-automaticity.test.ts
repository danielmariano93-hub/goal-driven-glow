import { describe, expect, it } from "vitest";
import { automaticityDue, automaticitySummary, isMaintenance, nudgeLevel, moneyEstimate, quitStats, milestoneToday, streakMilestoneToday, summarizeHabit, FIRM_FROM, type CycleRow } from "@/lib/habits/engine";

const cyc = (o: Partial<CycleRow>): CycleRow => ({ id: "c", habit_id: "h", started_on: "2026-10-01", ended_on: null, end_reason: null, baseline_daily_cost: null, baseline_source: null, ...o });

describe("quitStats", () => {
  it("conta dias do ciclo aberto, recorde e total sem perder nada na recaída", () => {
    const cycles = [cyc({ id: "a", started_on: "2026-09-01", ended_on: "2026-09-21", end_reason: "relapse" }), cyc({ id: "b", started_on: "2026-09-21" })];
    const s = quitStats("h", cycles, [], [{ habit_id: "h", local_date: "2026-09-21", reset: true }], "2026-10-01");
    expect(s.days_clean).toBe(10);
    expect(s.best).toBe(20);
    expect(s.total_days_clean).toBe(30);
    expect(s.relapses).toBe(1);
    expect(s.last_milestone).toBe(7);
    expect(s.next_milestone).toBe(14);
  });
  it("separa recaída que zera de escorregão só anotado", () => {
    const s = quitStats("h", [cyc({})], [], [{ habit_id: "h", local_date: "2026-10-02", reset: false }], "2026-10-05");
    expect(s.relapses).toBe(0);
    expect(s.noted_slips).toBe(1);
    expect(s.days_clean).toBe(4);
  });
  it("taxa de vontades superadas só considera as respondidas dos últimos 30 dias", () => {
    const cr = [
      { habit_id: "h", local_date: "2026-10-04", handled: true },
      { habit_id: "h", local_date: "2026-10-04", handled: false },
      { habit_id: "h", local_date: "2026-10-04", handled: null },
      { habit_id: "h", local_date: "2026-08-01", handled: true },
    ];
    const s = quitStats("h", [cyc({})], cr, [], "2026-10-05");
    expect(s.cravings_30).toBe(3);
    expect(s.craving_handled_rate).toBe(0.5);
  });
  it("sem ciclo aberto não inventa dias", () => {
    expect(quitStats("h", [], [], [], "2026-10-05").days_clean).toBe(0);
  });
});

describe("dinheiro e marcos", () => {
  it("estimativa nunca é negativa e some sem base", () => {
    expect(moneyEstimate(30, 10, 100)).toBe(200);
    expect(moneyEstimate(30, 2, 100)).toBe(0);
    expect(moneyEstimate(null, 10, 0)).toBeNull();
    expect(moneyEstimate(30, 10, null)).toBe(300);
  });
  it("marcos", () => {
    expect(milestoneToday(7)).toBe(7);
    expect(milestoneToday(8)).toBeNull();
    expect(streakMilestoneToday(30)).toBe(30);
    expect(streakMilestoneToday(5)).toBeNull();
  });
});

describe("automaticidade", () => {
  const ck = (on: string, score: number | null, skipped = false) => ({ habit_id: "h", answered_on: on, score, skipped });
  const habit = { id: "h", kind: "do_daily", started_on: "2026-10-01", status: "active" };
  it("pergunta pela primeira vez aos 14 dias e depois a cada 14", () => {
    expect(automaticityDue(habit, [], "2026-10-14")).toBe(false);
    expect(automaticityDue(habit, [], "2026-10-15")).toBe(true);
    expect(automaticityDue(habit, [ck("2026-10-15", 3)], "2026-10-28")).toBe(false);
    expect(automaticityDue(habit, [ck("2026-10-15", 3)], "2026-10-29")).toBe(true);
  });
  it("'agora não' volta em 7 dias; largar e pausado nunca", () => {
    expect(automaticityDue(habit, [ck("2026-10-15", null, true)], "2026-10-21")).toBe(false);
    expect(automaticityDue(habit, [ck("2026-10-15", null, true)], "2026-10-22")).toBe(true);
    expect(automaticityDue({ ...habit, kind: "quit" }, [], "2026-12-01")).toBe(false);
    expect(automaticityDue({ ...habit, status: "paused" }, [], "2026-12-01")).toBe(false);
  });
  it("resumo, variação e manutenção", () => {
    const s = automaticitySummary("h", [ck("2026-10-15", 3), ck("2026-10-29", 6), ck("2026-11-12", 7), ck("2026-11-26", 6), ck("2026-12-03", null, true)]);
    expect(s.first).toBe(3);
    expect(s.latest).toBe(6);
    expect(s.delta).toBe(3);
    expect(s.consecutive_high).toBe(3);
    expect(isMaintenance(s, 0.7, FIRM_FROM)).toBe(true);
    expect(isMaintenance(s, 0.5, FIRM_FROM)).toBe(false);
    expect(nudgeLevel(s, true)).toBe("none");
    expect(nudgeLevel(automaticitySummary("h", [ck("2026-10-15", 4)]), false)).toBe("reduced");
    expect(nudgeLevel(automaticitySummary("h", [ck("2026-10-15", 2)]), false)).toBe("normal");
  });
});

describe("pausa no resumo", () => {
  it("dias pausados não viram falha", () => {
    const def = { id: "h", kind: "do_daily" as const, started_on: "2026-10-01", days_of_week: null, weekly_target: null, quantity_target: null, quantity_period: null, rest_per_week: 1 };
    const logs = Array.from({ length: 7 }, (_, i) => ({ habit_id: "h", local_date: `2026-10-0${i + 1}`, status: "done" as const, quantity: null }));
    const a = summarizeHabit(def, logs, "2026-10-20", [{ from: "2026-10-08", to: "2026-10-19" }]);
    const b = summarizeHabit(def, logs, "2026-10-20", []);
    expect(a.adherence30!).toBeGreaterThan(b.adherence30!);
  });
});
