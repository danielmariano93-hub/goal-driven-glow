import { describe, it, expect } from "vitest";
import { resolveDocumentDate, inferYearFromPeriod, isValidCalendarDate } from "../../supabase/functions/_shared/documents/dates";

describe("resolveDocumentDate", () => {
  const today = "2026-07-17";
  it("aceita ISO explícito", () => {
    const r = resolveDocumentDate("2026-06-01", { today });
    expect(r).toMatchObject({ date: "2026-06-01", source: "iso" });
  });
  it("aceita dd/mm/yyyy", () => {
    expect(resolveDocumentDate("15/03/2024", { today }).date).toBe("2024-03-15");
  });
  it("rejeita data futura sem evidência", () => {
    const r = resolveDocumentDate("2099-01-01", { today, statement_period_end: "2026-06-30" });
    expect(r.date).toBe("2026-06-30");
    expect(r.source).toBe("period_end_fallback");
  });
  it("infere ano do período em datas parciais dd/mm", () => {
    const r = resolveDocumentDate("14/07", {
      today,
      statement_period_start: "2026-07-01",
      statement_period_end: "2026-07-31",
    });
    expect(r.date).toBe("2026-07-14");
    expect(r.source).toBe("period_inferred");
  });
  it("usa período do extrato como fallback antes de hoje", () => {
    const r = resolveDocumentDate("", { today, statement_period_end: "2026-06-30" });
    expect(r.date).toBe("2026-06-30");
  });
  it("virada de ano: dd/mm cai no ano do período", () => {
    const y = inferYearFromPeriod("01-05", { start: "2025-12-15", end: "2026-01-14" });
    expect(y).toBe(2026);
  });
  it("valida calendário (31/02 é inválido)", () => {
    expect(isValidCalendarDate("2026-02-31")).toBe(false);
    expect(isValidCalendarDate("2026-02-28")).toBe(true);
  });
});
