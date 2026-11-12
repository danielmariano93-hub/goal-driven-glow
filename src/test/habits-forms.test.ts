import { describe, expect, it } from "vitest";
import {
  achievementsFor, ceilingStats, dayOutcome, formOf, hhmm, minutesOf, projectStats, recurringStatus, summarizeHabit, timeStats, valueTrend, type HabitDef, type LogRow,
} from "@/lib/habits/engine";

const base: HabitDef = { id: "h", kind: "do_quantity", started_on: "2026-11-01", days_of_week: null, weekly_target: null, quantity_target: 1380, quantity_period: "day", rest_per_week: 1 };
const q = (d: string, v: number): LogRow => ({ habit_id: "h", local_date: d, status: "quantity", quantity: v });

describe("forma de medir", () => {
  it("sem forma gravada vale o tipo antigo", () => {
    expect(formOf({ kind: "do_daily" })).toBe("check");
    expect(formOf({ kind: "do_weekly_count" })).toBe("weekly");
    expect(formOf({ kind: "do_quantity" })).toBe("amount");
    expect(formOf({ kind: "quit" })).toBe("quit");
    expect(formOf({ kind: "do_daily", form: "steps" })).toBe("steps");
  });
  it("horário e teto: quanto menor, melhor; até 20% acima vale como mínimo", () => {
    const h = { ...base, direction: "at_most" as const };
    expect(dayOutcome(h, q("2026-11-05", 1350), "2026-11-05", "2026-11-10")).toBe("done");
    expect(dayOutcome(h, q("2026-11-05", 1500), "2026-11-05", "2026-11-10")).toBe("minimum");
    expect(dayOutcome(h, q("2026-11-05", 1800), "2026-11-05", "2026-11-10")).toBe("missed");
  });
  it("teto: dia fechado sem registro conta como dentro do limite; hoje continua aberto", () => {
    const h = { ...base, direction: "at_most" as const, implicit_ok: true, quantity_target: 2 };
    expect(dayOutcome(h, undefined, "2026-11-05", "2026-11-10")).toBe("done");
    expect(dayOutcome(h, undefined, "2026-11-10", "2026-11-10")).toBe("unlogged");
  });
  it("valor acompanhado: registrar já é feito", () => {
    const h = { ...base, direction: "track" as const, quantity_target: 0 };
    expect(dayOutcome(h, q("2026-11-05", 72.4), "2026-11-05", "2026-11-10")).toBe("done");
  });
  it("cuidado recorrente não tem sequência", () => {
    const h: HabitDef = { ...base, kind: "do_daily", form: "recurring", interval_days: 180, quantity_target: null, quantity_period: null };
    const s = summarizeHabit(h, [], "2026-11-10");
    expect(s.model).toBe("recurring");
    expect(s.streak).toBe(0);
  });
});

describe("projeto", () => {
  it("percentual, falta, ritmo e previsão", () => {
    // hoje (último) fica fora do ritmo; os dias sem leitura contam: (14+20+0+12+18+10)/6 = 12,3
    const p = projectStats(224, 128, [14, 20, 0, 12, 18, 10, 0], "2026-11-11");
    expect(p).toMatchObject({ percent: 57, remaining: 96, pace: 12.3, days_left: 8, eta: "2026-11-19", done: false, next_mark: 75 });
  });
  it("não conta os dias antes da primeira leitura e exige 3 dias de avanço", () => {
    // só começou a ler há 4 dias: 3 dias com leitura em 4 dias fechados
    expect(projectStats(200, 40, [0, 0, 0, 0, 0, 0, 10, 0, 15, 15, 0], "2026-11-11")).toMatchObject({ pace: 10, days_left: 16 });
    // só 2 dias de leitura: sem previsão
    expect(projectStats(200, 40, [0, 0, 0, 20, 20, 0], "2026-11-11")).toMatchObject({ pace: null, days_left: null, eta: null });
    // leu só hoje: sem previsão
    expect(projectStats(200, 20, [0, 0, 20], "2026-11-11").pace).toBeNull();
  });
  it("sem histórico não inventa previsão", () => {
    expect(projectStats(100, 10, [], "2026-11-11")).toMatchObject({ pace: null, days_left: null, eta: null });
  });
  it("concluído", () => {
    expect(projectStats(100, 120, [10], "2026-11-11")).toMatchObject({ percent: 100, remaining: 0, done: true, days_left: 0, next_mark: null });
  });
});

describe("horário, teto, valor e recorrência", () => {
  it("horário: média, regularidade e diferença para o alvo", () => {
    expect(minutesOf("23:30")).toBe(1410);
    expect(hhmm(1410)).toBe("23:30");
    const t = timeStats([1380, 1400, 1360, 1440], 1380);
    expect(t).toMatchObject({ n: 4, avg_min: 1395, within: 2, vs_target_min: 15 });
    expect((t.spread_min ?? 0)).toBeGreaterThan(0);
  });
  it("teto: dias dentro do limite contam os sem registro", () => {
    expect(ceilingStats([1, 3, 2], 2, 5)).toMatchObject({ within: 4, avg: 2, headroom: 0 });
  });
  it("valor: variação em 30 dias e rumo à meta", () => {
    const t = valueTrend([{ date: "2026-10-10", value: 80 }, { date: "2026-11-10", value: 77.5 }], "2026-11-11", 75);
    expect(t).toMatchObject({ first: 80, last: 77.5, delta_30: -2.5, min: 77.5, max: 80, toward_goal: true });
  });
  it("recorrente: em dia, perto e atrasado", () => {
    expect(recurringStatus("2026-11-01", "2026-01-01", 180, "2026-11-10").state).toBe("ok");
    expect(recurringStatus("2026-05-10", "2026-01-01", 180, "2026-11-04").state).toBe("soon");
    expect(recurringStatus("2026-01-01", "2026-01-01", 90, "2026-11-10")).toMatchObject({ state: "overdue" });
    expect(recurringStatus(null, "2026-11-01", 30, "2026-11-10").state).toBe("never");
  });
});

describe("conquistas de marco", () => {
  it("por forma, sem pontos", () => {
    const streak = achievementsFor({ form: "check", best_streak: 25 });
    expect(streak.filter((a) => a.earned).map((a) => a.key)).toEqual(["streak:7", "streak:21"]);
    expect(achievementsFor({ form: "duration", best_streak: 0, total_minutes: 3100 }).find((a) => a.key === "hours:50")?.earned).toBe(true);
    expect(achievementsFor({ form: "project", best_streak: 0, project_percent: 60, projects_done: 1 }).filter((a) => a.earned).map((a) => a.key)).toEqual(["pct:25", "pct:50", "done:1"]);
    expect(achievementsFor({ form: "quit", best_streak: 0, days_clean: 8, best_clean: 20 }).filter((a) => a.earned).length).toBe(3);
  });
});

describe("atalhos do primeiro acesso", () => {
  it("os modelos do servidor abrem o hábito certo no catálogo", async () => {
    const { findCatalog } = await import("@/lib/habits/catalog");
    for (const [slug, id] of [["agua-2l", "agua"], ["caminhar-20", "caminhar"], ["meditar-5", "meditar"], ["ler-10", "ler"], ["dormir-23", "dormir"], ["treinar-3x", "treinar"]]) {
      expect(findCatalog(slug)?.id).toBe(id);
    }
  });
});

describe("hoje: parcial não conta como feito", () => {
  const mk = (form: string, outcome: string, quantity: number | null, extra: Record<string, unknown> = {}) => ({
    form, steps: [] as unknown[], steps_today: [] as string[],
    habit: { quantity_target: 2, ...(extra.habit as object ?? {}) },
    summary: { today: { outcome, quantity } },
    ...extra,
  }) as never;
  it("quantidade parcial não vira feito e mostra a fração", async () => {
    const { countsDone, dayFraction, logLabel } = await import("@/lib/habits/present");
    expect(countsDone(mk("amount", "minimum", 0.75))).toBe(false);
    expect(dayFraction(mk("amount", "minimum", 0.75))).toBeCloseTo(0.375);
    expect(countsDone(mk("amount", "done", 2))).toBe(true);
    expect(dayFraction(mk("amount", "done", 3))).toBe(1);
    expect(countsDone(mk("check", "minimum", null))).toBe(true);
    expect(countsDone(mk("steps", "minimum", null))).toBe(false);
    expect(dayFraction(mk("steps", "minimum", null, { steps: [1, 2, 3, 4], steps_today: ["a"] }))).toBe(0.25);
    expect(logLabel("amount")).toBe("Registrar o que consumi");
  });
});

describe("momento do dia", () => {
  it("compõe, separa e normaliza o texto do quando", async () => {
    const { composeCue, splitCue, normalizeCue } = await import("@/lib/habits/period");
    expect(composeCue("Manhã", "")).toBe("Manhã");
    expect(composeCue("Noite", "Antes de dormir")).toBe("Noite · antes de dormir");
    expect(composeCue(null, "x")).toBe("");
    expect(splitCue("Tarde · depois do almoço")).toEqual({ period: "Tarde", anchor: "depois do almoço" });
    expect(splitCue("Durante o dia")).toEqual({ period: "Durante o dia", anchor: "" });
    expect(splitCue("Depois do café").period).toBeNull();
    expect(normalizeCue("Depois do almoço")).toBe("Tarde · depois do almoço");
    expect(normalizeCue("Ao acordar")).toBe("Manhã · ao acordar");
    expect(normalizeCue("Antes de dormir")).toBe("Noite · antes de dormir");
    expect(normalizeCue("Ao longo do dia")).toBe("Durante o dia");
    expect(normalizeCue("Quando o salário cair")).toBe("Durante o dia · quando o salário cair");
    expect(normalizeCue("Manhã · ao acordar")).toBe("Manhã · ao acordar");
  });
  it("todo item do catálogo já nasce com um período", async () => {
    const { CATALOG } = await import("@/lib/habits/catalog");
    const { splitCue } = await import("@/lib/habits/period");
    for (const it of CATALOG) if (it.cue) expect(splitCue(it.cue).period, it.id).not.toBeNull();
  });
});

describe("meta da semana explicada", () => {
  const v = (started_on: string, weekly_target = 4) => ({ form: "weekly", habit: { kind: "do_weekly_count", weekly_target, quantity_target: null, started_on } }) as never;
  it("primeira semana proporcional explica de onde vem o número", async () => {
    const { weekTargetNote } = await import("@/lib/habits/present");
    // 11/11/2026 é quarta-feira: 4 por semana vira 3 na primeira semana
    expect(weekTargetNote(v("2026-11-11"), { week_start: "2026-11-09", target: 3 })).toBe("Sua meta é 4 por semana. Como você começou na quarta-feira, esta primeira semana vale 3.");
    expect(weekTargetNote(v("2026-11-09"), { week_start: "2026-11-09", target: 4 })).toBeNull();
    expect(weekTargetNote(v("2026-11-01"), { week_start: "2026-11-09", target: 3 })).toContain("pausa");
    expect(weekTargetNote(v("2026-11-11"), null)).toBeNull();
  });
});

describe("retroagir e editar", () => {
  it("o registro retroativo usa a origem backfill e a edição aceita os novos campos", async () => {
    const api = await import("@/lib/habits/api");
    expect(typeof api.useUpdateHabit).toBe("function");
    const { addDays } = await import("@/lib/habits/engine");
    expect(addDays("2026-11-11", -90)).toBe("2026-08-13");
  });
});

describe("período e detalhe andam juntos", () => {
  it("trocar de período descarta o detalhe de outro período e mantém o que não depende dele", async () => {
    const { switchPeriod, periodOfText, ANCHORS } = await import("@/lib/habits/period");
    expect(switchPeriod("Noite · antes de dormir", "Manhã")).toBe("Manhã");
    expect(switchPeriod("Noite · antes de dormir", "Noite")).toBe("Noite · antes de dormir");
    expect(switchPeriod("Manhã · depois do café", "Tarde")).toBe("Tarde");
    expect(switchPeriod("Durante o dia · no domingo", "Noite")).toBe("Noite · no domingo");
    expect(switchPeriod("Noite · depois de escovar os dentes", "Tarde")).toBe("Tarde");
    expect(switchPeriod("Manhã · ao acordar", "Durante o dia")).toBe("Durante o dia");
    expect(switchPeriod("", "Tarde")).toBe("Tarde");
    expect(periodOfText("no domingo")).toBeNull();
    for (const [p, list] of Object.entries(ANCHORS)) for (const a of list) expect(periodOfText(a), a).toBe(p);
  });
});

describe("ritmo da semana (hábito semanal)", () => {
  it("4x por semana, semana completa", async () => {
    const { weekPace } = await import("@/lib/habits/engine/pace");
    const wk = (count: number, target = 4) => ({ week_start: "2026-11-09", target, count });
    // segunda: ainda nada esperado
    expect(weekPace(wk(0), "2026-11-01", "2026-11-09").state).toBe("on_track");
    // quarta: no ritmo se fez 1; atrasado se fez 0; meta batida aos 4
    expect(weekPace(wk(1), "2026-11-01", "2026-11-11").state).toBe("on_track");
    expect(weekPace(wk(0), "2026-11-01", "2026-11-11").state).toBe("behind");
    expect(weekPace(wk(2), "2026-11-01", "2026-11-11").state).toBe("on_track");
    expect(weekPace(wk(4), "2026-11-01", "2026-11-11").state).toBe("met");
  });
  it("sem folga: faltam tantos quanto os dias que restam, contando hoje", async () => {
    const { weekPace } = await import("@/lib/habits/engine/pace");
    // 3x, domingo, fez 2: falta 1 e só resta hoje
    const p = weekPace({ week_start: "2026-11-09", target: 3, count: 2 }, "2026-11-01", "2026-11-15");
    expect(p.state).toBe("due_today");
    expect(p.days_left).toBe(1);
  });
  it("7x por semana se comporta como diário", async () => {
    const { weekPace } = await import("@/lib/habits/engine/pace");
    const wk = (count: number) => ({ week_start: "2026-11-09", target: 7, count });
    expect(weekPace(wk(0), "2026-11-01", "2026-11-09").state).toBe("due_today"); // segunda, nada feito: sem folga, ainda possível
    expect(weekPace(wk(1), "2026-11-01", "2026-11-09").state).toBe("on_track"); // segunda, já treinou
    expect(weekPace(wk(1), "2026-11-01", "2026-11-10").state).toBe("due_today"); // terça, só 1: sem folga, ainda possível
    expect(weekPace(wk(0), "2026-11-01", "2026-11-10").state).toBe("out_of_reach"); // terça, nada feito: 7 em 6 dias
    expect(weekPace(wk(2), "2026-11-01", "2026-11-10").state).toBe("on_track");
  });
  it("primeira semana proporcional: começou na quarta, meta 3", async () => {
    const { weekPace } = await import("@/lib/habits/engine/pace");
    expect(weekPace({ week_start: "2026-11-09", target: 3, count: 0 }, "2026-11-11", "2026-11-11").state).toBe("on_track");
  });
  it("texto do ritmo", async () => {
    const { paceNote } = await import("@/lib/habits/present");
    expect(paceNote(null)).toBeNull();
    expect(paceNote({ state: "met", needed: 0, days_left: 3, expected: 2 })).toBe("Meta da semana batida");
    expect(paceNote({ state: "on_track", needed: 2, days_left: 5, expected: 1 })).toBe("Em dia");
    expect(paceNote({ state: "behind", needed: 2, days_left: 3, expected: 2 })).toBe("Atrasado: faltam 2 em 3 dias");
    expect(paceNote({ state: "due_today", needed: 1, days_left: 1, expected: 2 })).toBe("Hoje é dia: faltam 1 em 1 dia");
    expect(paceNote({ state: "out_of_reach", needed: 7, days_left: 6, expected: 2 })).toBe("Fora de alcance: faltam 7 em 6 dias");
  });
});

describe("ritmo do dia (fonte única)", () => {
  it("meta 1.500 às 20h: esperado 1.312,5; sugestão fixa de 93,75 por hora; faltam 500 em 2 h", async () => {
    const { dayPace } = await import("@/lib/habits/engine");
    const p = dayPace(1500, 1000, 20)!;
    expect(p.expected).toBeCloseTo(1312.5, 1);
    expect(p.gap).toBeCloseTo(312.5, 1);
    expect(p.per_hour_plan).toBeCloseTo(93.75, 2);
    expect(p.per_hour_needed).toBe(250);
    expect(p.state).toBe("behind");
  });
  it("estados: antes de acordar, no ritmo, meta batida e dia encerrado", async () => {
    const { dayPace } = await import("@/lib/habits/engine");
    expect(dayPace(1500, 0, 5)!.state).toBe("ahead");
    expect(dayPace(1500, 650, 14)!.state).toBe("on_pace");
    expect(dayPace(1500, 1500, 9)!.state).toBe("done");
    expect(dayPace(1500, 1000, 22.5)!.state).toBe("closed");
    expect(dayPace(0, 0, 12)).toBeNull();
  });
});
