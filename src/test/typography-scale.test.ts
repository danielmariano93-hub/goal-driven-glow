import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";

describe("escala tipográfica compacta", () => {
  const fs = (config.theme?.extend as { fontSize: Record<string, [string, { lineHeight: string }]> }).fontSize;
  it("reduz base e títulos, mantendo text-xs em 12px (padrão)", () => {
    expect(fs.base[0]).toBe("0.9375rem");
    expect(fs.sm[0]).toBe("0.8125rem");
    expect(fs["3xl"][0]).toBe("1.625rem");
    expect((config.theme?.extend as Record<string, unknown>).fontSize).not.toHaveProperty("xs");
  });
  it("cada tamanho cresce em ordem (sem inverter a hierarquia)", () => {
    const order = ["sm", "base", "lg", "xl", "2xl", "3xl"].map((k) => parseFloat(fs[k][0]));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
