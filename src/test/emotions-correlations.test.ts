import { describe, it, expect } from "vitest";
import { correlateByMoodCategory, MIN_SAMPLE } from "@/lib/emotions/correlations";

describe("correlateByMoodCategory", () => {
  it("marca como insuficiente quando amostra < mínimo", () => {
    const txns = Array.from({ length: 4 }, () => ({
      mood: "ansioso",
      category: "Lazer",
      weekday: 1,
      amount: 50,
    }));
    const r = correlateByMoodCategory(txns);
    expect(r[0].sufficient).toBe(false);
    expect(r[0].count).toBe(4);
  });

  it(`marca como suficiente com ≥${MIN_SAMPLE} amostras`, () => {
    const txns = Array.from({ length: MIN_SAMPLE }, () => ({
      mood: "ansioso",
      category: "Lazer",
      weekday: 1,
      amount: 50,
    }));
    const r = correlateByMoodCategory(txns);
    expect(r[0].sufficient).toBe(true);
    expect(r[0].avg).toBe(50);
  });

  it("ignora sem categoria ou humor", () => {
    const r = correlateByMoodCategory([{ mood: "", category: "X", weekday: 0, amount: 1 } as any]);
    expect(r).toEqual([]);
  });
});
