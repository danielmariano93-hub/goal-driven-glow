import { describe, expect, it } from "vitest";
import {
  parseEmotionFromText,
  moodToEmotion,
  resolveEmotionTerm,
} from "../../supabase/functions/_shared/intelligence/emotionParse.ts";
import {
  detectExpectation,
  isExpectationFresh,
} from "../../supabase/functions/_shared/agent/core/ConversationExpectation.ts";

describe("emotionParse — respostas curtas de humor", () => {
  it("entende frase natural", () => {
    expect(parseEmotionFromText("Estou me sentindo atento hoje")?.key).toBe("atento");
  });

  it("entende resposta de uma palavra", () => {
    expect(parseEmotionFromText("cansado")?.key).toBe("frustrado");
    expect(resolveEmotionTerm("ansioso")?.key).toBe("atento");
  });

  it("entende escala 1..5", () => {
    expect(moodToEmotion(4)?.key).toBe("confiante");
    expect(moodToEmotion(1)?.mood).toBe(1);
  });

  it("não inventa emoção em texto financeiro", () => {
    expect(parseEmotionFromText("quanto gastei em agosto")).toBeNull();
  });
});

describe("ConversationExpectation", () => {
  it("detecta que o Nino perguntou sobre o humor", () => {
    const expectation = detectExpectation("Como você está se sentindo hoje com o seu dinheiro?");
    expect(expectation?.kind).toBe("emotional_checkin");
  });

  it("não cria expectativa em resposta comum", () => {
    expect(detectExpectation("Hoje você gastou R$ 120,00 em 3 lançamentos.")).toBeNull();
  });

  it("expira expectativa antiga", () => {
    const old = { kind: "emotional_checkin" as const, asked_at: new Date(Date.now() - 20 * 3600_000).toISOString() };
    const fresh = { kind: "emotional_checkin" as const, asked_at: new Date().toISOString() };
    expect(isExpectationFresh(old)).toBe(false);
    expect(isExpectationFresh(fresh)).toBe(true);
  });
});
