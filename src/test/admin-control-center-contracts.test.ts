import { describe, expect, it } from "vitest";
import { dict } from "@/lib/admin/displayDictionary";
import { formatRate, rate, sampleLabel } from "@/lib/admin/formulas";

describe("admin control center formulas", () => {
  it("does not render zero when denominator is zero", () => {
    expect(rate(0, 0)).toBeNull();
    expect(formatRate(rate(0, 0))).toBe("—");
  });

  it("formats valid rates", () => {
    expect(formatRate(rate(3, 4))).toBe("75%");
  });

  it("qualifies small samples", () => {
    expect(sampleLabel(1)).toBe("Amostra insuficiente");
    expect(sampleLabel(15)).toBe("Sinal inicial");
    expect(sampleLabel(20)).toBeNull();
  });
});

describe("admin display dictionary", () => {
  it("translates canonical features", () => {
    expect(dict.feature("agent")).toBe("Conversas com o Nino");
    expect(dict.feature("split_reminder")).toBe("Lembretes da divisão");
  });

  it("translates funnel steps", () => {
    expect(dict.step("initiated")).toBe("Iniciou");
    expect(dict.step("value_delivered")).toBe("Recebeu valor");
  });
});
