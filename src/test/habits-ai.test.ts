import { describe, expect, it } from "vitest";
import { AI_MONTHLY_CAP_USD, factNumbers, fallbackNarrative, guardNarrative, isClinicalText, numbersIn, planRefused, sanitizePlan, type ReviewFacts } from "../../supabase/functions/_shared/habits/ai";

const facts: ReviewFacts = { rows: [{ habit_id: "h", title: "Meditar", done: 4, expected: 7, prev_done: 2, prev_expected: 7 }] };

describe("guarda de números", () => {
  it("extrai números em formato brasileiro", () => {
    expect(numbersIn("R$ 1.234,56 e 3 dias, 0,5")).toEqual([1234.56, 3, 0.5]);
  });
  it("aprova texto que só usa números dos fatos", () => {
    expect(guardNarrative("Você meditou 4 de 7 dias, 2 a mais que antes. Que tal repetir na próxima semana?", factNumbers(facts)).ok).toBe(true);
  });
  it("reprova número inventado, link, texto longo e vazio", () => {
    expect(guardNarrative("Você meditou 5 de 7 dias. Siga firme nesse ritmo!", factNumbers(facts)).reason).toMatch(/number_not_in_facts/);
    expect(guardNarrative("Veja em https://x.com como melhorar a rotina toda semana", factNumbers(facts)).reason).toBe("link");
    expect(guardNarrative("a".repeat(500), []).reason).toBe("too_long");
    expect(guardNarrative("ok", []).reason).toBe("empty");
  });
  it("reprova linguagem clínica", () => {
    expect(guardNarrative("Para sua ansiedade, medite 4 vezes por semana, é um bom tratamento.", factNumbers(facts)).reason).toBe("clinical");
    expect(isClinicalText("parar de fumar cigarro")).toBe(true);
    expect(isClinicalText("Ler 10 páginas")).toBe(false);
  });
  it("texto de reserva usa só números dos fatos e nenhuma culpa", () => {
    const t = fallbackNarrative(facts);
    expect(numbersIn(t).every((n) => factNumbers(facts).includes(n))).toBe(true);
    expect(t).not.toMatch(/falh|culpa|ruim/i);
  });
});

describe("sugestão de plano", () => {
  it("hábito de saúde ou substância é recusado", () => {
    expect(planRefused("Parar de fumar")).toBe(true);
    expect(planRefused("Fazer dieta")).toBe(true);
    expect(planRefused("Meditar 5 min")).toBe(false);
  });
  it("aceita gatilho 'Depois de…' e mínimo curto; descarta o que foge da regra", () => {
    expect(sanitizePlan({ cue_text: "Depois de tomar café", minimum_text: "3 respirações" }, "Meditar 5 min")).toEqual({ cue_text: "Depois de tomar café", minimum_text: "3 respirações" });
    expect(sanitizePlan({ cue_text: "De manhã", minimum_text: "30 minutos de corrida" }, "Meditar 5 min")).toEqual({ cue_text: null, minimum_text: null });
    expect(sanitizePlan({ cue_text: "Depois de tomar remédio", minimum_text: null }, "Meditar").cue_text).toBeNull();
    expect(sanitizePlan("lixo", "Meditar")).toEqual({ cue_text: null, minimum_text: null });
  });
  it("teto mensal é pequeno", () => {
    expect(AI_MONTHLY_CAP_USD).toBeLessThanOrEqual(0.25);
  });
});
