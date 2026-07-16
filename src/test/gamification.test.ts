import { describe, it, expect } from "vitest";
import { xpToLevel, progressToNext } from "@/lib/gamification/rules";

describe("gamification", () => {
  it("nível 1 abaixo de 100xp, sobe com sqrt", () => {
    expect(xpToLevel(0)).toBe(1);
    expect(xpToLevel(99)).toBe(1);
    expect(xpToLevel(100)).toBe(2);
    expect(xpToLevel(400)).toBe(3);
  });

  it("progressToNext calcula porcentagem", () => {
    const p = progressToNext(150);
    expect(p.level).toBe(2);
    expect(p.percent).toBeGreaterThan(0);
    expect(p.percent).toBeLessThan(100);
  });
});
