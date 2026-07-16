import { describe, it, expect } from "vitest";
import { creditCardSchema, computeCompetenceDateISO } from "@/lib/validation/creditCards";

describe("credit card validation", () => {
  it("accepts a valid card", () => {
    const r = creditCardSchema.safeParse({
      name: "Nubank",
      total_limit: 5000,
      closing_day: 25,
      due_day: 10,
      active: true,
    });
    expect(r.success).toBe(true);
  });
  it("rejects closing_day out of range", () => {
    const r = creditCardSchema.safeParse({
      name: "X",
      total_limit: 1000,
      closing_day: 40,
      due_day: 10,
      active: true,
    });
    expect(r.success).toBe(false);
  });
  it("rejects negative total_limit", () => {
    const r = creditCardSchema.safeParse({
      name: "X",
      total_limit: -1,
      closing_day: 5,
      due_day: 15,
      active: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("credit card competence", () => {
  it("purchase before closing day → same month", () => {
    // fecha dia 25; compra dia 10/01 → competência 01/01
    expect(computeCompetenceDateISO("2026-01-10", 25)).toBe("2026-01-01");
  });
  it("purchase after closing day → next month", () => {
    // fecha dia 25; compra dia 26/01 → competência 01/02
    expect(computeCompetenceDateISO("2026-01-26", 25)).toBe("2026-02-01");
  });
  it("purchase on closing day → same month", () => {
    expect(computeCompetenceDateISO("2026-03-25", 25)).toBe("2026-03-01");
  });
  it("december boundary wraps year", () => {
    expect(computeCompetenceDateISO("2026-12-26", 25)).toBe("2027-01-01");
  });
});

describe("net worth does not include credit card limit", () => {
  it("computeNetWorth excludes credit_cards entirely", async () => {
    const { computeNetWorth } = await import("@/lib/engine/facts");
    const nw = computeNetWorth(
      [{ id: "a1", name: "X", type: "checking", opening_balance: 1000, active: true }],
      [],
      [],
      []
    );
    // Adding cards should not change net worth (they aren't a param)
    expect(nw.net).toBe(1000);
    expect(nw.cash).toBe(1000);
    expect(nw.invested).toBe(0);
    expect(nw.owed).toBe(0);
  });
});
