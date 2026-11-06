import { describe, expect, it } from "vitest";
import { stageTimings } from "../../supabase/functions/_shared/agent/core/StageTimings";

describe("tempo por etapa do turno", () => {
  it("separa IA do resto e soma o total", () => {
    expect(stageTimings(9000, 6500)).toEqual({ llm_ms: 6500, stage_ms: { total: 9000, llm: 6500, other: 2500 } });
  });
  it("sem chamada de IA, llm_ms fica nulo e tudo é 'other'", () => {
    expect(stageTimings(1700, 0)).toEqual({ llm_ms: null, stage_ms: { total: 1700, llm: 0, other: 1700 } });
    expect(stageTimings(1700, undefined).llm_ms).toBeNull();
  });
  it("nunca deixa a IA passar do total nem ficar negativa (relógios e somas imperfeitas)", () => {
    expect(stageTimings(1000, 5000).stage_ms).toEqual({ total: 1000, llm: 1000, other: 0 });
    expect(stageTimings(1000, -5).llm_ms).toBeNull();
    expect(stageTimings(Number.NaN, 10).stage_ms.total).toBe(0);
  });
});
