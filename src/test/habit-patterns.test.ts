import { describe, expect, it } from "vitest";
import { buildHabitPatterns, HABIT_PATTERN_RULES } from "../../supabase/functions/_shared/proactive/habitPatterns";
import { buildWeekendForecasts, weekendFridayOf } from "../../supabase/functions/_shared/proactive/weekendForecast";
import { projectedForTarget } from "@/lib/behavioral/habitPatterns";

const FRI = "2026-10-09";
const day = (offset: number, from = FRI) => new Date(Date.parse(`${from}T12:00:00Z`) + offset * 86_400_000).toISOString();

/** Fins de semana de uma categoria: `amounts[w-1]` na sexta de w semanas atrás (+ sábado menor). */
function weekends(category: string, amounts: number[]) {
  return amounts.flatMap((amount, i) => [
    { occurred_at: day(-7 * (i + 1)), amount, category },
    { occurred_at: day(-7 * (i + 1) + 1), amount: amount / 2, category },
  ]);
}
const lazer = weekends("Lazer", [200, 260, 180, 300, 220, 250, 190, 280, 210, 240, 230, 270]);
const goals = { Lazer: { name: "Lazer", limit: 1000, actual: 340 } };

describe("weekendFridayOf", () => {
  it("sexta é hoje; seg–qui é a próxima; sáb/dom é a que acabou de passar", () => {
    expect(weekendFridayOf("2026-10-09")).toBe("2026-10-09");
    expect(weekendFridayOf("2026-10-05")).toBe("2026-10-09");
    expect(weekendFridayOf("2026-10-08")).toBe("2026-10-09");
    expect(weekendFridayOf("2026-10-10")).toBe("2026-10-09");
    expect(weekendFridayOf("2026-10-11")).toBe("2026-10-09");
  });
  it("a mensagem proativa continua só na sexta (padrão inalterado)", () => {
    expect(buildWeekendForecasts(lazer, "2026-10-07", goals)).toEqual([]);
    expect(buildWeekendForecasts(lazer, FRI, goals).length).toBe(1);
    expect(buildWeekendForecasts(lazer, "2026-10-07", goals, { anyDay: true })[0].friday).toBe("2026-10-09");
  });
});

describe("nino_habit_patterns.v1", () => {
  it("padrão de fim de semana com evidência, hipóteses alternativas, confiança e ação", () => {
    const r = buildHabitPatterns({ transactions: lazer, today: FRI, goals });
    expect(r.shown).toHaveLength(1);
    const p = r.shown[0];
    expect(p.category).toBe("Lazer");
    expect(p.evidence.length).toBeGreaterThanOrEqual(2);
    expect(p.evidence.length).toBeLessThanOrEqual(3);
    expect(p.evidence[0]).toMatch(/12 dos últimos 12 fins de semana/);
    expect(p.alternatives.length).toBeGreaterThan(0);
    expect(p.confidence).toBeGreaterThanOrEqual(HABIT_PATTERN_RULES.minConfidence);
    expect(p.meaning).toMatch(/pode fechar|Se esse padrão/);
    // sem causa psicológica inventada
    expect(JSON.stringify(p)).not.toMatch(/impuls|ansied|tristez|compuls/i);
  });

  it("AC-07: a conta do limite é coerente (efeito = projeção − esperado + limite) e é hipótese com faixa", () => {
    const p = buildHabitPatterns({ transactions: lazer, today: FRI, goals }).shown[0];
    const a = p.action;
    expect(a?.kind).toBe("suggest_limit");
    if (a?.kind !== "suggest_limit") return;
    expect(a.projected_if_met).toBeCloseTo(a.projected_before - a.expected + a.target, 1);
    expect(projectedForTarget(a, a.target)).toBeCloseTo(a.projected_if_met, 1);
    expect(a.target).toBeLessThan(a.expected);
    expect(a.projected_low).toBeLessThanOrEqual(a.projected_before);
    expect(a.projected_high).toBeGreaterThanOrEqual(a.projected_before);
    expect(a.scenarios[0].target).toBeNull();
    expect(a.scenarios.every((s) => s.projected_month > 0)).toBe(true);
    expect(a.rationale.join(" ")).toMatch(/estimativa, não uma garantia/);
    expect(a.friday).toBe(FRI);
  });

  it("meta inviável (limite do mês pede quase zero por fim de semana): sugere rever a meta, não um corte", () => {
    const tight = { Lazer: { name: "Lazer", limit: 400, actual: 380 } };
    const a = buildHabitPatterns({ transactions: lazer, today: FRI, goals: tight }).shown[0]?.action;
    expect(a?.kind).toBe("review_goal");
    if (a?.kind === "review_goal") expect(a.rationale.join(" ")).toMatch(/meta precise ser revista/);
  });

  it("sábado/domingo: o fim de semana já começou, então não oferece limite", () => {
    const p = buildHabitPatterns({ transactions: lazer, today: "2026-10-10", goals }).shown[0];
    expect(p?.action?.kind).not.toBe("suggest_limit");
  });

  it("AC-06: no máximo 2 padrões; o excedente fica registrado como 'overflow'", () => {
    const tx = [
      ...lazer,
      ...weekends("Transporte", [120, 150, 130, 160, 140, 150, 135, 155, 145, 150, 140, 160]),
      ...weekends("Alimentação", [110, 130, 120, 140, 125, 135, 118, 132, 128, 138, 122, 136]),
    ];
    const r = buildHabitPatterns({ transactions: tx, today: FRI, goals: { ...goals, Transporte: { name: "Transporte", limit: 600, actual: 200 }, "Alimentação": { name: "Alimentação", limit: 700, actual: 250 } } });
    expect(r.shown.length).toBeLessThanOrEqual(HABIT_PATTERN_RULES.maxShown);
    expect(r.suppressed.some((s) => s.reason === "overflow")).toBe(true);
    const sorted = [...r.shown].sort((a, b) => b.utility - a.utility);
    expect(r.shown.map((p) => p.id)).toEqual(sorted.map((p) => p.id));
  });

  it("controle de repetição e recusa: a mesma descoberta não volta", () => {
    const first = buildHabitPatterns({ transactions: lazer, today: FRI, goals }).shown[0];
    const repeated = buildHabitPatterns({ transactions: lazer, today: FRI, goals, recentKeys: new Set([first.repetition_key]) });
    expect(repeated.shown).toHaveLength(0);
    expect(repeated.suppressed).toContainEqual({ id: first.id, reason: "repeated" });
    const dismissed = buildHabitPatterns({ transactions: lazer, today: FRI, goals, dismissedIds: new Set([first.id]) });
    expect(dismissed.shown).toHaveLength(0);
  });

  it("base fraca não vira descoberta: poucos fins de semana com gasto, nenhum padrão", () => {
    const few = weekends("Lazer", [200, 260, 180]);
    expect(buildHabitPatterns({ transactions: few, today: FRI, goals }).shown).toHaveLength(0);
  });

  it("categorias de data fixa (assinaturas, moradia) nunca viram hábito de fim de semana", () => {
    const subs = weekends("Assinaturas", [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    expect(buildHabitPatterns({ transactions: subs, today: FRI, goals: {} }).shown).toHaveLength(0);
  });
});
