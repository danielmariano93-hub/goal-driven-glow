import { describe, expect, it } from "vitest";
import { resolveV2DeterministicHumanCapability } from "../../supabase/functions/_shared/agent/core/V2DeterministicHumanGate.ts";

describe("V2 deterministic human events — regression", () => {
  it.each([
    "Ansioso",
    "Estou me sentindo ansioso hoje",
    "hoje eu fui ansioso",
  ])("preserva check-in emocional explícito: %s", (text) => {
    const capability = resolveV2DeterministicHumanCapability(text);
    expect(capability?.name).toBe("emotional_checkin");
    expect(capability?.execution).toBe("deterministic");
    expect(capability?.required_tool).toBe("log_emotional_checkin");
  });

  it.each([
    "Quando eu fico ansioso eu gasto mais?",
    "Estou preocupado com a fatura do cartão",
    "Quanto gastei hoje?",
  ])("não sequestra intenção financeira/conversacional: %s", (text) => {
    expect(resolveV2DeterministicHumanCapability(text)).toBeNull();
  });
});
