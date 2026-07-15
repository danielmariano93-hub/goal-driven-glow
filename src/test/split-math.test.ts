import { describe, it, expect } from "vitest";
import { splitEqual, validateCustomSplit } from "@/lib/split/math";

describe("splitEqual", () => {
  it("divide R$100 entre 3 com centavos ordenados", () => {
    const r = splitEqual(100, [{ name: "Ana" }, { name: "Bruno" }, { name: "Carla" }]);
    const sum = r.reduce((s, p) => s + Math.round(p.amount_due * 100), 0);
    expect(sum).toBe(10000);
    expect(r.map((x) => x.amount_due).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it("dono recebe primeiro os centavos residuais", () => {
    const r = splitEqual(10, [
      { name: "Zeca" },
      { name: "Ana", is_owner: true },
      { name: "Bruno" },
    ]);
    const owner = r.find((x) => x.is_owner)!;
    expect(owner.amount_due).toBeGreaterThanOrEqual(3.33);
  });

  it("total exato divide igualmente", () => {
    const r = splitEqual(90, [{ name: "A" }, { name: "B" }, { name: "C" }]);
    expect(r.every((x) => x.amount_due === 30)).toBe(true);
  });

  it("rejeita total inválido", () => {
    expect(() => splitEqual(0, [{ name: "A" }])).toThrow();
    expect(() => splitEqual(10, [])).toThrow();
  });
});

describe("validateCustomSplit", () => {
  it("aceita soma exata", () => {
    expect(validateCustomSplit(100, [40, 30, 30]).ok).toBe(true);
  });
  it("rejeita soma diferente", () => {
    expect(validateCustomSplit(100, [40, 30, 20]).ok).toBe(false);
  });
  it("tolera 1 centavo", () => {
    expect(validateCustomSplit(100, [33.33, 33.33, 33.34]).ok).toBe(true);
  });
});
