import { describe, expect, it } from "vitest";
import { interpret, isValidCalendarDate, resolveOccurredAt, resolveRelativeDate, shiftSaoPaulo, todaySaoPaulo } from "@/lib/agent/parser";

// Build a Date such that America/Sao_Paulo (UTC-3) shows the ISO wall date.
function spDate(iso: string, hour = 12): Date {
  // hour is Sao_Paulo wall-clock hour; UTC = hour + 3
  return new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00-03:00`);
}

describe("isValidCalendarDate", () => {
  it("rejects bogus month/day", () => {
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
    expect(isValidCalendarDate("2026-02-31")).toBe(false);
    expect(isValidCalendarDate("2026-07-17")).toBe(true);
  });
  it("rejects year outside range and non-iso", () => {
    expect(isValidCalendarDate("1800-01-01")).toBe(false);
    expect(isValidCalendarDate("17/07/2026")).toBe(false);
    expect(isValidCalendarDate("" as unknown as string)).toBe(false);
  });
});

describe("resolveRelativeDate", () => {
  it("interpret('gastei 21,90 ontem') resolves to previous day (fixed now)", () => {
    const now = spDate("2026-07-18", 10);
    const parsed = interpret("gastei 21,90 ontem", now);
    expect(parsed.kind).toBe("transaction");
    if (parsed.kind === "transaction") expect(parsed.occurred_at).toBe("2026-07-17");
    expect(resolveRelativeDate("gastei 21,90 ontem", now)).toBe("2026-07-17");
  });
  it("handles month boundary", () => {
    const now = spDate("2026-03-01", 9);
    expect(resolveRelativeDate("ontem gastei 10", now)).toBe("2026-02-28");
    expect(resolveRelativeDate("anteontem", now)).toBe("2026-02-27");
  });
  it("handles year boundary (Jan 1st)", () => {
    const now = spDate("2027-01-01", 9);
    expect(resolveRelativeDate("ontem", now)).toBe("2026-12-31");
    expect(resolveRelativeDate("anteontem", now)).toBe("2026-12-30");
  });
  it("stays on previous day near midnight UTC but still yesterday in SP", () => {
    // 02:30 UTC on 2026-07-18 == 23:30 on 2026-07-17 in America/Sao_Paulo
    const now = new Date("2026-07-18T02:30:00Z");
    expect(todaySaoPaulo(now)).toBe("2026-07-17");
    expect(resolveRelativeDate("ontem", now)).toBe("2026-07-16");
  });
});

describe("resolveOccurredAt server-side guardrail", () => {
  it("relative anchor overrides any model value", () => {
    const now = spDate("2026-07-18", 10);
    const r = resolveOccurredAt({ text: "gastei 21,90 ontem no Itaú", modelValue: "2024-05-07", now });
    expect(r).toEqual({ iso: "2026-07-17", source: "relative" });
  });
  it("keeps a valid, plausible model value when text has no anchor", () => {
    const now = spDate("2026-07-18", 10);
    const r = resolveOccurredAt({ text: "compra do mercado", modelValue: "2026-07-10", now });
    expect(r.iso).toBe("2026-07-10");
    expect(r.source).toBe("model");
  });
  it("rejects future dates and falls back to today", () => {
    const now = spDate("2026-07-18", 10);
    const r = resolveOccurredAt({ text: "gastei 50 no bar", modelValue: "2027-01-05", now });
    expect(r.iso).toBe("2026-07-18");
    expect(r.note).toBe("future_rejected");
  });
  it("rejects model month 13 and 31/02", () => {
    const now = spDate("2026-07-18", 10);
    expect(resolveOccurredAt({ text: "x", modelValue: "2026-13-05", now }).iso).toBe("2026-07-18");
    expect(resolveOccurredAt({ text: "x", modelValue: "2026-02-31", now }).iso).toBe("2026-07-18");
  });
  it("rejects >370-day-old model value when text has NO explicit ISO", () => {
    const now = spDate("2026-07-18", 10);
    const r = resolveOccurredAt({ text: "gastei 21,90 no mc donalds", modelValue: "2024-05-07", now });
    expect(r.iso).toBe("2026-07-18");
    expect(r.note).toBe("too_old_rejected");
  });
  it("accepts an old explicit ISO literal in the text (manual import path)", () => {
    const now = spDate("2026-07-18", 10);
    const r = resolveOccurredAt({ text: "lançamento antigo do dia 2023-04-01", modelValue: "2023-04-01", now });
    expect(r.iso).toBe("2023-04-01");
    expect(r.source).toBe("model");
  });
  it("falls back to today in America/Sao_Paulo when no data", () => {
    const now = spDate("2026-07-18", 10);
    expect(resolveOccurredAt({ text: "", modelValue: null, now })).toEqual({ iso: "2026-07-18", source: "today" });
  });
});

describe("shiftSaoPaulo", () => {
  it("shifts across leap boundary", () => {
    expect(shiftSaoPaulo("2028-03-01", -1)).toBe("2028-02-29");
  });
});
