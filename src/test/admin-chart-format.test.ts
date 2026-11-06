import { describe, expect, it } from "vitest";
import { dayFull, dayTick, xAxisProps } from "@/lib/admin/chartFormat";

describe("eixo de tempo dos gráficos do admin", () => {
  it("data ISO vira dia/mês curto; mês vira abreviação; outro texto fica como veio", () => {
    expect(dayTick("2026-10-24")).toBe("24/10");
    expect(dayTick("2026-10-24T03:00:00Z")).toBe("24/10");
    expect(dayTick("2026-10")).toBe("out/26");
    expect(dayTick("05/11")).toBe("05/11");
    expect(dayTick("semana de 03/11")).toBe("semana de 03/11");
    expect(dayTick(undefined)).toBe("");
  });
  it("a dica do gráfico traz dia da semana e ano", () => {
    expect(dayFull("2026-11-05")).toBe("qui, 05/11/2026");
    expect(dayFull("2026-11")).toBe("nov de 2026");
    expect(dayFull("05/11")).toBe("05/11");
  });
  it("poucos pontos mostram todos os rótulos; muitos mostram extremos sem sobrepor", () => {
    expect(xAxisProps(7).interval).toBe(0);
    expect(xAxisProps(30).interval).toBe("preserveStartEnd");
    expect(xAxisProps(30).height).toBeGreaterThanOrEqual(28);
  });
});
