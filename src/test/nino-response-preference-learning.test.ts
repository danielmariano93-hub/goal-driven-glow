import { describe, expect, it } from "vitest";
import { detectResponsePreference } from "../../supabase/functions/_shared/agent/core/ResponsePreferenceLearning";

describe("Nino explicit response preference learning", () => {
  it("learns concise communication only from meta instructions", () => {
    expect(detectResponsePreference("Prefiro que você me responda de forma curta e direta")?.patch)
      .toMatchObject({ verbosity: "concise" });
    expect(detectResponsePreference("Quero gastar menos e ter mais renda")).toBeNull();
  });

  it("learns technicality, suggestion frequency and tone", () => {
    expect(detectResponsePreference("Pode me explicar de forma mais técnica, pode usar jargão")?.patch)
      .toMatchObject({ technical_level: "advanced", explanation_style: "technical" });
    expect(detectResponsePreference("Não precisa sugerir próximos passos, só responda")?.patch)
      .toMatchObject({ suggestion_frequency: "low" });
    expect(detectResponsePreference("Pode sugerir próximos passos quando fizer sentido")?.patch)
      .toMatchObject({ suggestion_frequency: "high" });
    expect(detectResponsePreference("Quero que você seja mais natural e humano")?.patch)
      .toMatchObject({ tone: "friendly" });
  });
});
