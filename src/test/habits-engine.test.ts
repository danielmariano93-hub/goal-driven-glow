import { describe, expect, it } from "vitest";
import {
  adherence, adherenceWindow, addDays, dayOutcome, dayRows, diffDays, dow, FORMULA_VERSION, isExpectedDay, phaseOf,
  streakDaily, streakWeekly, strengthSeriesDaily, strengthSeriesWeekly, summarizeHabit, weekRows, weekStart,
  type HabitDef, type LogRow, type LogStatus,
} from "@/lib/habits/engine";

const base = (over: Partial<HabitDef> = {}): HabitDef => ({
  id: "h1", kind: "do_daily", started_on: "2026-10-01", days_of_week: null, weekly_target: null,
  quantity_target: null, quantity_period: null, rest_per_week: 1, ...over,
});
const L = (local_date: string, status: LogStatus, quantity: number | null = null, habit_id = "h1"): LogRow => ({ habit_id, local_date, status, quantity });
/** Registros "done" em uma lista de datas. */
const dones = (dates: string[]) => dates.map((d) => L(d, "done"));
const range = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe("datas civis", () => {
  it("segunda-feira da semana ISO e dia da semana", () => {
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // domingo pertence à semana que começou na segunda
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(dow("2026-11-10")).toBe(2);
    expect(diffDays("2026-11-01", "2026-11-10")).toBe(9);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("resultado do dia (modelo diário)", () => {
  const h = base({ started_on: "2026-11-01" });
  const today = "2026-11-10";
  it("antes do início e depois de hoje não é previsto", () => {
    expect(dayOutcome(h, undefined, "2026-10-31", today)).toBe("not_expected");
    expect(dayOutcome(h, undefined, "2026-11-11", today)).toBe("not_expected");
  });
  it("hoje sem registro está aberto; ontem sem registro é falha", () => {
    expect(dayOutcome(h, undefined, today, today)).toBe("unlogged");
    expect(dayOutcome(h, undefined, "2026-11-09", today)).toBe("missed");
  });
  it("cada status vira o resultado certo; 'hoje não' conta como falha, sem drama", () => {
    expect(dayOutcome(h, L("2026-11-09", "done"), "2026-11-09", today)).toBe("done");
    expect(dayOutcome(h, L("2026-11-09", "minimum"), "2026-11-09", today)).toBe("minimum");
    expect(dayOutcome(h, L("2026-11-09", "rest"), "2026-11-09", today)).toBe("rest");
    expect(dayOutcome(h, L("2026-11-09", "skipped"), "2026-11-09", today)).toBe("missed");
  });
  it("dias da semana escolhidos: o resto não é previsto", () => {
    const seg = base({ started_on: "2026-11-01", days_of_week: [1, 3, 5] });
    expect(isExpectedDay(seg, "2026-11-09")).toBe(true); // segunda
    expect(isExpectedDay(seg, "2026-11-10")).toBe(false); // terça
    expect(dayOutcome(seg, undefined, "2026-11-10", "2026-11-12")).toBe("not_expected");
  });
  it("quantidade por dia: meta batida é feito; parcial de dia fechado vale mínima só a partir de metade; hoje parcial segue aberto", () => {
    const q = base({ kind: "do_quantity", quantity_target: 10, quantity_period: "day", started_on: "2026-11-01" });
    expect(dayOutcome(q, L("2026-11-09", "quantity", 10), "2026-11-09", today)).toBe("done");
    expect(dayOutcome(q, L("2026-11-09", "quantity", 6), "2026-11-09", today)).toBe("minimum");
    expect(dayOutcome(q, L("2026-11-09", "quantity", 4), "2026-11-09", today)).toBe("missed");
    expect(dayOutcome(q, L("2026-11-09", "quantity", 0), "2026-11-09", today)).toBe("missed");
    expect(dayOutcome(q, L(today, "quantity", 2.5), today, today)).toBe("unlogged");
  });
  it("pausa: dias pausados não são previstos, então não viram falha", () => {
    const pauses = [{ from: "2026-11-03", to: "2026-11-05" }];
    expect(dayOutcome(h, undefined, "2026-11-04", today, pauses)).toBe("not_expected");
    expect(dayOutcome(h, undefined, "2026-11-06", today, pauses)).toBe("missed");
    const open = [{ from: "2026-11-08", to: null }];
    expect(dayOutcome(h, undefined, "2026-11-09", today, open)).toBe("not_expected");
  });
});

describe("adesão", () => {
  it("feito + 0,6·mínimo, dividido por previstos; folga e dia aberto ficam fora", () => {
    const rows = [
      ...range("2026-11-01", 3).map((date) => ({ date, outcome: "done" as const })),
      { date: "2026-11-04", outcome: "minimum" as const },
      { date: "2026-11-05", outcome: "missed" as const },
      { date: "2026-11-06", outcome: "rest" as const },
      { date: "2026-11-07", outcome: "unlogged" as const },
    ];
    expect(adherence(rows)).toBeCloseTo((3 + 0.6) / 5, 10);
  });
  it("sem dia previsto fechado não há adesão (nulo, não zero)", () => {
    expect(adherence([])).toBeNull();
    expect(adherence([{ date: "2026-11-01", outcome: "rest" }, { date: "2026-11-02", outcome: "unlogged" }])).toBeNull();
  });
  it("janelas de 7 e 30 dias", () => {
    const h = base({ started_on: "2026-10-01" });
    const logs = dones(range("2026-10-01", 40).filter((d) => d !== "2026-11-05"));
    const rows = dayRows(h, logs, "2026-10-01", "2026-11-09", "2026-11-09");
    expect(adherenceWindow(rows, "2026-11-09", 7)).toBeCloseTo(6 / 7, 10);
    expect(adherenceWindow(rows, "2026-11-09", 30)).toBeCloseTo(29 / 30, 10);
  });
});

describe("sequência (modelo diário)", () => {
  const h = base({ started_on: "2026-11-01" });
  const today = "2026-11-10";
  it("conta os dias seguidos e o hoje aberto não a quebra", () => {
    const rows = dayRows(h, dones(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]), "2026-11-01", today, today);
    expect(streakDaily(rows)).toEqual({ current: 4, best: 4 });
  });
  it("um dia fechado em branco quebra a atual, mas o recorde fica", () => {
    const rows = dayRows(h, dones(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-07"]), "2026-11-01", today, today);
    const s = streakDaily(rows);
    expect(s.best).toBe(4);
    expect(s.current).toBe(0); // 06 e 08/09 em branco: a última corrida acabou em falha
  });
  it("folga não quebra e não soma", () => {
    const logs = [...dones(["2026-11-06", "2026-11-08", "2026-11-09"]), L("2026-11-07", "rest")];
    const rows = dayRows(h, logs, "2026-11-01", today, today);
    expect(streakDaily(rows).current).toBe(3);
  });
  it("versão mínima conta como feito para a sequência", () => {
    const logs = [L("2026-11-08", "done"), L("2026-11-09", "minimum")];
    const rows = dayRows(h, logs, "2026-11-08", today, today);
    expect(streakDaily(rows).current).toBe(2);
  });
});

describe("força do hábito (estimativa)", () => {
  const h = base({ started_on: "2026-11-01" });
  it("14 dias seguidos fazem a força chegar a 50% (meia-vida de 14 dias)", () => {
    const rows = dayRows(h, dones(range("2026-11-01", 14)), "2026-11-01", "2026-11-15", "2026-11-15");
    const s = strengthSeriesDaily(rows);
    expect(s[13]).toBeCloseTo(0.5, 6);
  });
  it("sobe com constância, cai devagar com falha e nunca passa de 1 nem de 0", () => {
    const logs = dones(range("2026-11-01", 20));
    const rows = dayRows(h, logs, "2026-11-01", "2026-11-30", "2026-11-30"); // 10 dias seguidos em branco no fim
    const s = strengthSeriesDaily(rows);
    expect(s[19]).toBeGreaterThan(s[10]);
    expect(s[29]).toBeLessThan(s[19]);
    expect(s[29]).toBeGreaterThan(0);
    for (const v of s) expect(v >= 0 && v <= 1).toBe(true);
  });
  it("folga é neutra: com ou sem ela a força final é a mesma dos dias que contam", () => {
    const withRest = dayRows(h, [...dones(["2026-11-01", "2026-11-02", "2026-11-04"]), L("2026-11-03", "rest")], "2026-11-01", "2026-11-05", "2026-11-05");
    const without = dayRows(h, dones(["2026-11-01", "2026-11-02", "2026-11-04"]), "2026-11-01", "2026-11-05", "2026-11-05");
    // sem folga o dia 03 vira falha: a força com folga tem de ser maior
    expect(strengthSeriesDaily(withRest)[3]).toBeGreaterThan(strengthSeriesDaily(without)[3]);
    // e a folga em si não mexe no valor do dia dela
    const s = strengthSeriesDaily(withRest);
    expect(s[2]).toBeCloseTo(s[1], 12);
  });
  it("versão mínima pesa menos que feito e mais que falha", () => {
    const run = (status: LogStatus | null) => {
      const logs = status ? [L("2026-11-01", status)] : [];
      return strengthSeriesDaily(dayRows(h, logs, "2026-11-01", "2026-11-02", "2026-11-02"))[0];
    };
    expect(run("done")).toBeGreaterThan(run("minimum"));
    expect(run("minimum")).toBeGreaterThan(run(null));
  });
  it("faixas: começando até 14 dias fechados, depois raiz e firme", () => {
    expect(phaseOf(0.8, 10, false)).toBe("starting");
    expect(phaseOf(0.2, 40, false)).toBe("starting");
    expect(phaseOf(0.5, 40, false)).toBe("rooting");
    expect(phaseOf(0.7, 40, false)).toBe("firm");
    expect(phaseOf(null, 40, false)).toBe("starting");
    expect(FORMULA_VERSION).toBe("hb_formula.v1");
  });
});

describe("modelo semanal (X por semana)", () => {
  const h = base({ kind: "do_weekly_count", weekly_target: 3, started_on: "2026-10-26" }); // segunda
  it("semana cumprida, semana parcial e semana aberta", () => {
    const logs = dones(["2026-10-26", "2026-10-28", "2026-10-30", "2026-11-02", "2026-11-04"]);
    const weeks = weekRows(h, logs, "2026-11-05");
    expect(weeks.map((w) => [w.week_start, w.met, w.closed])).toEqual([["2026-10-26", true, true], ["2026-11-02", false, false]]);
    expect(weeks[1].progress).toBeCloseTo(2 / 3, 10);
  });
  it("versão mínima vale 0,6 na meta semanal", () => {
    const weeks = weekRows(h, [L("2026-10-26", "done"), L("2026-10-27", "done"), L("2026-10-28", "minimum")], "2026-11-05");
    expect(weeks[0].count).toBeCloseTo(2.6, 10);
    expect(weeks[0].met).toBe(false);
  });
  it("hábito que começa no meio da semana tem meta proporcional", () => {
    const mid = base({ kind: "do_weekly_count", weekly_target: 4, started_on: "2026-10-29" }); // quinta: 4 dias disponíveis
    const w = weekRows(mid, [], "2026-11-10")[0];
    expect(w.target).toBe(2); // round(4 · 4/7)
  });
  it("sequência em semanas: semana aberta não cumprida não quebra", () => {
    const logs = dones(["2026-10-26", "2026-10-28", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"]);
    const weeks = weekRows(h, logs, "2026-11-10"); // 26/10 e 02/11 cumpridas; 09/11 aberta e vazia
    expect(streakWeekly(weeks)).toEqual({ current: 2, best: 2 });
  });
  it("uma semana fechada abaixo da meta zera a sequência atual", () => {
    const logs = dones(["2026-10-26", "2026-10-28", "2026-10-30", "2026-11-02"]);
    const weeks = weekRows(h, logs, "2026-11-10");
    expect(streakWeekly(weeks)).toEqual({ current: 0, best: 1 });
  });
  it("força semanal usa só semanas fechadas", () => {
    const logs = dones(["2026-10-26", "2026-10-28", "2026-10-30"]);
    const weeks = weekRows(h, logs, "2026-11-03");
    const s = strengthSeriesWeekly(weeks);
    expect(s[0]).toBeCloseTo(1 - Math.pow(2, -1 / 2), 10);
    expect(s[1]).toBeCloseTo(s[0], 12); // semana aberta não muda
  });
  it("quantidade por semana soma os registros", () => {
    const q = base({ kind: "do_quantity", quantity_target: 100, quantity_period: "week", started_on: "2026-10-26" });
    const w = weekRows(q, [L("2026-10-26", "quantity", 40), L("2026-10-28", "quantity", 70)], "2026-11-05")[0];
    expect(w.count).toBe(110);
    expect(w.met).toBe(true);
    expect(w.progress).toBe(1);
  });
});

describe("resumo do hábito para as telas", () => {
  it("hábito que começa amanhã: hoje não é previsto e não há força", () => {
    const s = summarizeHabit(base({ started_on: "2026-11-11" }), [], "2026-11-10");
    expect(s.today.outcome).toBe("not_expected");
    expect(s.strength).toBeNull();
    expect(s.phase).toBe("starting");
    expect(s.streak).toBe(0);
  });
  it("força só aparece depois de 7 dias previstos fechados", () => {
    const h = base({ started_on: "2026-11-01" });
    expect(summarizeHabit(h, dones(range("2026-11-01", 6)), "2026-11-07").strength).toBeNull();
    expect(summarizeHabit(h, dones(range("2026-11-01", 7)), "2026-11-08").strength).not.toBeNull();
  });
  it("orçamento de folgas da semana", () => {
    const h = base({ started_on: "2026-11-01", rest_per_week: 1 });
    const s0 = summarizeHabit(h, [], "2026-11-10");
    expect(s0.rests_left_this_week).toBe(1);
    const s1 = summarizeHabit(h, [L("2026-11-09", "rest")], "2026-11-10");
    expect([s1.rests_used_this_week, s1.rests_left_this_week]).toEqual([1, 0]);
    // folga da semana anterior não conta
    const s2 = summarizeHabit(h, [L("2026-11-08", "rest")], "2026-11-10");
    expect(s2.rests_used_this_week).toBe(0);
  });
  it("estado de hoje e adesão de um hábito em dia", () => {
    const h = base({ started_on: "2026-11-01" });
    const logs = [...dones(range("2026-11-01", 9)), L("2026-11-10", "minimum")];
    const s = summarizeHabit(h, logs, "2026-11-10");
    expect(s.today.outcome).toBe("minimum");
    expect(s.streak).toBe(10);
    expect(s.best_streak).toBe(10);
    expect(s.adherence7).toBeCloseTo((6 + 0.6) / 7, 10);
  });
  it("hábito semanal: resumo traz a semana corrente", () => {
    const h = base({ kind: "do_weekly_count", weekly_target: 3, started_on: "2026-10-26" });
    const s = summarizeHabit(h, dones(["2026-11-10"]), "2026-11-10");
    expect(s.model).toBe("weekly");
    expect(s.week?.count).toBe(1);
    expect(s.today.outcome).toBe("done");
  });
  it("registros de outro hábito não contaminam o resumo", () => {
    const h = base({ started_on: "2026-11-01" });
    const s = summarizeHabit(h, [L("2026-11-09", "done", null, "outro")], "2026-11-10");
    expect(s.streak).toBe(0);
  });
});
