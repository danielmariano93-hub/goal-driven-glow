import { describe, expect, it } from "vitest";
import { buildHabitPatterns, HABIT_PATTERN_RULES, type LimitSuggestion } from "../../supabase/functions/_shared/proactive/habitPatterns";
import { buildWeekendForecasts, weekendFridayOf } from "../../supabase/functions/_shared/proactive/weekendForecast";
import { CONTEXT_ANSWER_VALID_DAYS, DIMENSION_WEIGHS, PATTERN_QUESTION } from "../../supabase/functions/_shared/proactive/habitContext";
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
const transporte = weekends("Transporte", [150, 170, 140, 190, 160, 180, 150, 175, 165, 185, 155, 170]);
const goals = { Lazer: { name: "Lazer", limit: 1000, actual: 340 } };
// Transporte com meta inviável (quase estourada): o padrão pede revisar a meta, não um corte.
const bothGoals = { ...goals, Transporte: { name: "Transporte", limit: 400, actual: 380 } };
const both = [...lazer, ...transporte];
const answerRow = (category: string, key: string, at = "2026-10-09T12:00:00Z") => ({ subject: `weekend:${category}`, question: "planned_vs_spontaneous", answer_keys: [key], updated_at: at });
const answers = (key: string, at?: string) => ["Lazer", "Transporte"].map((c) => answerRow(c, key, at));

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

describe("nino_habit_patterns.v2 — seleção e consolidação", () => {
  it("duas categorias de fim de semana viram UM insight (não dois cards iguais)", () => {
    const r = buildHabitPatterns({ transactions: both, today: FRI, goals: bothGoals });
    const weekend = r.shown.filter((p) => p.scope === "weekend");
    expect(weekend).toHaveLength(1);
    const p = weekend[0];
    expect([...p.categories].sort()).toEqual(["Lazer", "Transporte"]);
    expect(p.id).toBe("weekend:Lazer+Transporte");
    expect(p.title).toMatch(/Lazer e Transporte|Transporte e Lazer/);
    expect(p.evidence).toHaveLength(2);
    expect(p.evidence.every((e) => /fins de semana/.test(e))).toBe(true);
  });

  it("traz UMA linha de consequência (hipótese) e diz o que o Nino ainda não sabe", () => {
    const p = buildHabitPatterns({ transactions: both, today: FRI, goals: bothGoals }).shown[0];
    expect(p.consequence.split(". ").length).toBeLessThanOrEqual(1 + 0);
    expect(p.consequence).toMatch(/Se esse ritmo continuar/);
    expect(p.unknown).toMatch(/Ainda não sei se esses gastos são planejados/);
    expect(JSON.stringify(p)).not.toMatch(/impuls|ansied|tristez|compuls/i);
  });

  it("pergunta só quando a resposta muda a recomendação — e as ações só vêm depois da resposta", () => {
    const p = buildHabitPatterns({ transactions: both, today: FRI, goals: bothGoals }).shown[0];
    expect(p.question?.key).toBe(PATTERN_QUESTION.key);
    expect(p.question?.options.map((o) => o.key)).toEqual(["planned", "spontaneous", "for_others", "depends"]);
    expect(p.actions).toEqual([]);
    expect(p.skip_actions.length).toBeGreaterThan(0);
  });

  it("padrão por dia da semana sem ação possível NÃO pergunta (perguntar não mudaria nada)", () => {
    // Alimentação: toda segunda, sem fim de semana
    const mondays = Array.from({ length: 12 }, (_, i) => ({ occurred_at: day(-7 * (i + 1) - 4), amount: 90 + (i % 3) * 10, category: "Alimentação" }));
    const others = Array.from({ length: 80 }, (_, i) => ({ occurred_at: day(-(i + 1) * 1), amount: 4, category: "Alimentação" })).filter((t) => new Date(t.occurred_at).getUTCDay() !== 1);
    const r = buildHabitPatterns({ transactions: [...mondays, ...others], today: "2026-10-12", goals: {} });
    for (const p of r.shown.filter((x) => x.scope === "weekday")) {
      expect(p.question).toBeNull();
      expect(p.consequence).toMatch(/soma perto de/);
    }
  });
});

describe("a resposta muda a recomendação (e nunca vira diagnóstico)", () => {
  const at = (key: string) => buildHabitPatterns({ transactions: both, today: FRI, goals: bothGoals, contextAnswers: answers(key) }).shown[0];

  it("já planejado → o ajuste é na meta, nunca limite de gasto", () => {
    const p = at("planned");
    expect(p.answer?.key).toBe("planned");
    expect(p.question).toBeNull();
    expect(p.actions.length).toBeGreaterThan(0);
    expect(p.actions.every((a) => a.kind === "review_goal" || a.kind === "create_goal")).toBe(true);
    expect(p.actions.some((a) => a.kind === "suggest_limit")).toBe(false);
    expect(p.interpretation).toMatch(/meta, não no seu comportamento/);
  });

  it("decido na hora → limite opcional (com a conta), e meta inviável continua sendo revisão de meta", () => {
    const p = at("spontaneous");
    const limit = p.actions.find((a) => a.kind === "suggest_limit") as LimitSuggestion | undefined;
    expect(limit?.category).toBe("Lazer");
    expect(limit!.projected_if_met).toBeCloseTo(limit!.projected_before - limit!.expected + limit!.target, 1);
    expect(projectedForTarget(limit!, limit!.target)).toBeCloseTo(limit!.projected_if_met, 1);
    expect(p.actions.find((a) => a.category === "Transporte")?.kind).toBe("review_goal");
  });

  it("envolve outras pessoas → dividir a conta; depende → só observa (sem ação)", () => {
    expect(at("for_others").actions.every((a) => a.kind === "shared_expenses")).toBe(true);
    const d = at("depends");
    expect(d.actions).toEqual([]);
    expect(d.interpretation).toMatch(/continua observando/);
    expect(d.question).toBeNull();
  });

  it(`a resposta vale ${CONTEXT_ANSWER_VALID_DAYS} dias; depois o Nino pergunta de novo`, () => {
    const old = buildHabitPatterns({ transactions: both, today: FRI, goals: bothGoals, contextAnswers: answers("planned", "2026-08-01T12:00:00Z") }).shown[0];
    expect(old.answer).toBeNull();
    expect(old.question).not.toBeNull();
  });

  it("respondido, o insight perde prioridade (já se aprendeu o que faltava)", () => {
    const asked = buildHabitPatterns({ transactions: both, today: FRI, goals: bothGoals }).shown[0];
    expect(at("planned").utility).toBeLessThan(asked.utility);
  });
});

describe("regras de seleção", () => {
  it("sábado/domingo: o fim de semana já começou, então não oferece limite", () => {
    const p = buildHabitPatterns({ transactions: lazer, today: "2026-10-10", goals, contextAnswers: [answerRow("Lazer", "spontaneous")] }).shown[0];
    expect(p?.actions.some((a) => a.kind === "suggest_limit") ?? false).toBe(false);
  });

  it("AC-06: no máximo 2 insights; excedente fica registrado", () => {
    const r = buildHabitPatterns({ transactions: both, today: FRI, goals: bothGoals });
    expect(r.shown.length).toBeLessThanOrEqual(HABIT_PATTERN_RULES.maxShown);
    const sorted = [...r.shown].sort((a, b) => b.utility - a.utility);
    expect(r.shown.map((p) => p.id)).toEqual(sorted.map((p) => p.id));
  });

  it("a página não precisa estar cheia: sem padrão relevante, nada é mostrado", () => {
    expect(buildHabitPatterns({ transactions: weekends("Lazer", [200, 260, 180]), today: FRI, goals }).shown).toHaveLength(0);
  });

  it("controle de repetição e recusa: o mesmo insight não volta", () => {
    const first = buildHabitPatterns({ transactions: lazer, today: FRI, goals }).shown[0];
    const repeated = buildHabitPatterns({ transactions: lazer, today: FRI, goals, recentKeys: new Set([first.repetition_key]) });
    expect(repeated.shown).toHaveLength(0);
    expect(repeated.suppressed).toContainEqual({ id: first.id, reason: "repeated" });
    expect(buildHabitPatterns({ transactions: lazer, today: FRI, goals, dismissedIds: new Set([first.id]) }).shown).toHaveLength(0);
  });

  it("categorias de data fixa (assinaturas, moradia) nunca viram hábito de fim de semana", () => {
    const subs = weekends("Assinaturas", Array(12).fill(100));
    expect(buildHabitPatterns({ transactions: subs, today: FRI, goals: {} }).shown).toHaveLength(0);
  });
});

describe("catálogo de contexto das dimensões", () => {
  it("toda dimensão tem opções fechadas, com 'outro motivo' e chaves únicas", () => {
    for (const [dim, opts] of Object.entries(DIMENSION_WEIGHS)) {
      expect(opts.length, dim).toBeGreaterThanOrEqual(3);
      expect(new Set(opts.map((o) => o.key)).size).toBe(opts.length);
      expect(opts.some((o) => o.key === "other")).toBe(true);
    }
    expect(Object.keys(DIMENSION_WEIGHS).sort()).toEqual(["awareness", "calm", "consistency", "control", "debt", "planning", "security", "wealth"]);
  });
});
