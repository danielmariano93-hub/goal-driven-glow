import { describe, it, expect } from "vitest";
import { currentMonthPartial, previousOf, resolvePeriods, daysInMonthOf } from "@/lib/reports/intelligent/periods";

describe("relatório do mês corrente (monthly_partial)", () => {
  it("vai do dia 1 até a data de referência e diz que o mês está aberto", () => {
    const p = currentMonthPartial(new Date(2026, 7, 14)); // 14/08/2026
    expect(p.start).toBe("2026-08-01");
    expect(p.end).toBe("2026-08-14");
    expect(p.label).toContain("até");
  });

  it("compara com a MESMA janela de dias do mês anterior", () => {
    const { period, previous } = resolvePeriods("monthly_partial", new Date(2026, 7, 14));
    expect(period.end).toBe("2026-08-14");
    expect(previous.start).toBe("2026-07-01");
    expect(previous.end).toBe("2026-07-14");
  });

  it("não inventa dia inexistente no mês anterior", () => {
    const p = { start: "2026-03-01", end: "2026-03-31", label: "" };
    expect(previousOf(p, "monthly_partial").end).toBe("2026-02-28");
  });

  it("mês fechado segue com a regra antiga", () => {
    const { period, previous } = resolvePeriods("monthly", new Date(2026, 7, 14));
    expect(period.start).toBe("2026-07-01");
    expect(previous.start).toBe("2026-06-01");
  });

  it("conta os dias do mês da referência", () => {
    expect(daysInMonthOf(new Date(2026, 1, 10))).toBe(28);
    expect(daysInMonthOf(new Date(2026, 7, 10))).toBe(31);
  });
});
