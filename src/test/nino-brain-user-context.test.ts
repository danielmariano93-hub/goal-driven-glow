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
    const merchantCorrection = value.durable_memory.find((m: any) => m.key === "merchant:x");
    expect(merchantCorrection?.value.note).toContain("mercado");
    expect(merchantCorrection?.value.amount).toBeUndefined();
    expect(merchantCorrection?.value.saldo).toBeUndefined();
  });

  it("prioritizes explicit user memory when the context window is crowded", () => {
    const inferred = Array.from({ length: 25 }, (_, i) => ({
      id: `i-${i}`, user_id: "u", kind: "habit", key: `habit-${i}`,
      value: { note: `inferred-${i}` }, confidence: 0.9, source: "inferred",
      use_count: 10, last_used_at: new Date().toISOString(),
      created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
    }));
    const explicit = {
      id: "explicit", user_id: "u", kind: "context", key: "explicit-user-fact",
      value: { note: "prefiro revisar decisões com calma" }, confidence: 1, source: "user",
      use_count: 0, last_used_at: null,
      created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
    };
    const json = serializeBrainUserContext(
      {
        tone: "friendly", verbosity: "balanced", explanation_style: "plain",
        example_style: "concrete", suggestion_frequency: "medium", technical_level: "basic",
      },
      [...inferred, explicit] as any,
    );
    const durable = JSON.parse(json).durable_memory;
    expect(durable).toHaveLength(12);
    expect(durable.some((m: any) => m.key === "explicit-user-fact")).toBe(true);
    expect(json.length).toBeLessThanOrEqual(3_500);
  });

  it("bounds verbose relationship memory without touching preferences", () => {
    const json = serializeBrainUserContext(
      {
        tone: "friendly", verbosity: "concise", explanation_style: "plain",
        example_style: "concrete", suggestion_frequency: "low", technical_level: "intermediate",
      },
      Array.from({ length: 20 }, (_, i) => ({
        id: String(i), user_id: "u", kind: "context", key: `context-${i}`,
        value: { note: `fato ${i} ${"texto longo ".repeat(80)}` }, confidence: 1, source: "user",
        use_count: 0, last_used_at: null, created_at: "", updated_at: "",
      })) as any,
    );
    const value = JSON.parse(json);
    expect(json.length).toBeLessThanOrEqual(3_500);
    expect(value.preferences.verbosity).toBe("concise");
    expect(value.preferences.suggestion_frequency).toBe("low");
    expect(value.durable_memory.length).toBeLessThanOrEqual(12);
    expect(value.durable_memory[0].value.note.length).toBeLessThanOrEqual(320);
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
