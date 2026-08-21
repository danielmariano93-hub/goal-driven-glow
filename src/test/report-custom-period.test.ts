import { describe, expect, it } from "vitest";
import { customPeriodOf, daysInPeriod, previousOf, resolvePeriods } from "@/lib/reports/intelligent/periods";

describe("relatório de período livre", () => {
  it("preserva exatamente o intervalo pedido", () => {
    const { period } = resolvePeriods("custom", new Date("2026-08-21T12:00:00Z"), {
      start: "2026-05-01",
      end: "2026-08-20",
    });
    expect(period.start).toBe("2026-05-01");
    expect(period.end).toBe("2026-08-20");
    expect(period.label).toBe("01/05 a 20/08");
  });

  it("normaliza intervalo invertido", () => {
    expect(customPeriodOf({ start: "2026-08-20", end: "2026-05-01" })).toMatchObject({
      start: "2026-05-01",
      end: "2026-08-20",
    });
  });

  it("compara com o período anterior de mesma duração, imediatamente antes", () => {
    const { period, previous } = resolvePeriods("custom", new Date("2026-08-21T12:00:00Z"), {
      start: "2026-05-01",
      end: "2026-08-20",
    });
    expect(daysInPeriod(previous)).toBe(daysInPeriod(period));
    expect(previous.end).toBe("2026-04-30");
  });

  it("exige o intervalo quando o tipo é custom", () => {
    expect(() => resolvePeriods("custom", new Date("2026-08-21T12:00:00Z"))).toThrow("custom_period_required");
  });

  it("mantém o comportamento dos tipos fechados", () => {
    const monthly = resolvePeriods("monthly", new Date("2026-08-21T12:00:00Z"));
    expect(monthly.period.start).toBe("2026-07-01");
    expect(previousOf(monthly.period, "monthly").start).toBe("2026-06-01");
  });
});
