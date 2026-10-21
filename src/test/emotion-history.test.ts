import { describe, expect, it } from "vitest";
import { buildEvolution, buildWeekStrip, emojiForMood, highSpendDays, MIN_POINTS_FOR_EVOLUTION, summarizeWeek } from "@/lib/emotions/history";

const at = (day: string, emotion: string, hour = 15) => ({ occurred_at: `${day}T${String(hour).padStart(2, "0")}:00:00-03:00`, emotion_key: emotion });
const TODAY = "2026-10-21";

describe("calendário da semana", () => {
  it("traz 7 dias terminando hoje, com o emoji do dia e dias vazios sem culpa", () => {
    const week = buildWeekStrip([at("2026-10-21", "tranquilo"), at("2026-10-19", "preocupado")], TODAY);
    expect(week.map((d) => d.date)[0]).toBe("2026-10-15");
    expect(week[6]).toMatchObject({ isToday: true, weekday: "qua" });
    expect(week[6].emotion?.emoji).toBe("😌");
    expect(week[4].emotion?.key).toBe("preocupado");
    expect(week[5].emotion).toBeNull();
  });
  it("com dois registros no dia, vale o último e a contagem aparece", () => {
    const week = buildWeekStrip([at("2026-10-21", "ansioso", 9), at("2026-10-21", "tranquilo", 20)], TODAY);
    expect(week[6].emotion?.key).toBe("tranquilo");
    expect(week[6].count).toBe(2);
  });
  it("aceita registro antigo só com humor numérico", () => {
    const week = buildWeekStrip([{ occurred_at: "2026-10-20T12:00:00-03:00", mood: 5 }], TODAY);
    expect(week[5].emotion?.mood).toBe(5);
  });
  it("fuso: um registro às 23h de São Paulo fica no dia certo", () => {
    const week = buildWeekStrip([{ occurred_at: "2026-10-21T23:30:00-03:00", emotion_key: "atento" }], TODAY);
    expect(week[6].emotion?.key).toBe("atento");
  });
});

describe("evolução", () => {
  const rows = ["16", "17", "18", "19", "20", "21"].map((d, i) => at(`2026-10-${d}`, i % 2 ? "tranquilo" : "preocupado"));
  it("por dia até 45 dias; por semana acima disso", () => {
    expect(buildEvolution(rows, TODAY, 30)).toHaveLength(6);
    const weeks = buildEvolution(rows, TODAY, 90);
    expect(weeks.length).toBeLessThan(6);
    expect(weeks.every((w) => w.n >= 1)).toBe(true);
  });
  it("ignora registros fora da janela", () => {
    expect(buildEvolution([at("2026-08-01", "tranquilo"), ...rows], TODAY, 30)).toHaveLength(6);
  });
  it("só desenha com pontos suficientes", () => {
    expect(MIN_POINTS_FOR_EVOLUTION).toBeGreaterThanOrEqual(4);
  });
  it("emoji por humor médio", () => {
    expect(emojiForMood(5)).toBe("😌");
    expect(emojiForMood(1)).toBe("😟");
  });
});

describe("frase da semana", () => {
  it("sem registro não inventa frase", () => {
    expect(summarizeWeek(buildWeekStrip([], TODAY))).toBeNull();
  });
  it("descreve o mais frequente, sem causa nem julgamento", () => {
    const week = buildWeekStrip([at("2026-10-15", "preocupado"), at("2026-10-16", "preocupado"), at("2026-10-17", "preocupado"), at("2026-10-20", "tranquilo"), at("2026-10-21", "tranquilo")], TODAY);
    const s = summarizeWeek(week)!;
    expect(s).toMatch(/preocupado \(3 dias\)/);
    expect(s).toMatch(/mais leves/);
    expect(s).not.toMatch(/porque|causa|gast/i);
  });
});

describe("gasto alto ao lado do humor", () => {
  it("só marca com histórico suficiente e dias bem acima do usual", () => {
    const small = new Map([["2026-10-01", 50], ["2026-10-02", 60]]);
    expect(highSpendDays(small).size).toBe(0);
    const spend = new Map<string, number>();
    for (let d = 1; d <= 10; d++) spend.set(`2026-10-${String(d).padStart(2, "0")}`, 50);
    spend.set("2026-10-11", 600);
    expect([...highSpendDays(spend)]).toEqual(["2026-10-11"]);
  });
});
