import { describe, expect, it } from "vitest";
import { formatPeriodLabel } from "@/lib/ui/periodStore";

describe("rótulo editorial do período", () => {
  it("compacta intervalos no mesmo mês", () => {
    expect(formatPeriodLabel("2026-08-01", "2026-08-05")).toBe("1–5 de agosto");
  });

  it("evita repetir o ano em meses diferentes", () => {
    expect(formatPeriodLabel("2026-07-28", "2026-08-05")).toBe("28 de julho–5 de agosto");
  });

  it("nomeia mês completo", () => {
    expect(formatPeriodLabel("2026-08-01", "2026-08-31")).toBe("Agosto de 2026");
  });
});