import { describe, expect, it } from "vitest";
import { serializeBrainUserContext } from "../../supabase/functions/_shared/agent/core/BrainUserContext";

describe("Conversation Brain durable user context", () => {
  it("carries stable preferences and explicit memories across sessions", () => {
    const json = serializeBrainUserContext(
      {
        tone: "friendly",
        verbosity: "concise",
        explanation_style: "plain",
        example_style: "concrete",
        suggestion_frequency: "high",
        technical_level: "intermediate",
      },
      [
        {
          id: "1", user_id: "u", kind: "response_preference", key: "brevity",
          value: { preference: "respostas curtas" }, confidence: 1, source: "user",
          use_count: 2, last_used_at: null, created_at: "", updated_at: "",
        },
        {
          id: "2", user_id: "u", kind: "correction", key: "merchant:x",
          value: { note: "esse estabelecimento é mercado", amount: 9999, saldo: 8888 },
          confidence: 1, source: "correction", use_count: 1, last_used_at: null,
          created_at: "", updated_at: "",
        },
      ] as any,
    );
    const value = JSON.parse(json);
    expect(value.preferences.verbosity).toBe("concise");
    expect(value.preferences.suggestion_frequency).toBe("high");
    expect(value.durable_memory).toHaveLength(2);
    expect(value.durable_memory[1].value.note).toContain("mercado");
    expect(value.durable_memory[1].value.amount).toBeUndefined();
    expect(value.durable_memory[1].value.saldo).toBeUndefined();
  });

  it("drops low-confidence inferred relationship memory", () => {
    const json = serializeBrainUserContext(
      {
        tone: "friendly", verbosity: "balanced", explanation_style: "plain",
        example_style: "concrete", suggestion_frequency: "medium", technical_level: "basic",
      },
      [{
        id: "1", user_id: "u", kind: "habit", key: "maybe",
        value: { note: "talvez goste disso" }, confidence: 0.4, source: "inferred",
        use_count: 0, last_used_at: null, created_at: "", updated_at: "",
      }] as any,
    );
    expect(JSON.parse(json).durable_memory).toEqual([]);
  });
});
