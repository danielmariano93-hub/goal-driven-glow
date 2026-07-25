import { describe, it, expect } from "vitest";
import { resolvePreset, todaySP } from "@/lib/admin/periodPresets";

// Congela "agora" em 15/07/2026 12:00 UTC (09:00 SP)
const NOW = new Date("2026-07-15T12:00:00Z");

describe("periodPresets", () => {
  it("todaySP returns the São Paulo local date", () => {
    expect(todaySP(NOW)).toBe("2026-07-15");
  });

  it("today preset returns single-day range", () => {
    expect(resolvePreset("today", undefined, NOW)).toEqual({ from: "2026-07-15", to: "2026-07-15" });
  });

  it("yesterday preset returns previous day", () => {
    expect(resolvePreset("yesterday", undefined, NOW)).toEqual({ from: "2026-07-14", to: "2026-07-14" });
  });

  it("7d preset spans last 7 calendar days inclusive", () => {
    expect(resolvePreset("7d", undefined, NOW)).toEqual({ from: "2026-07-09", to: "2026-07-15" });
  });

  it("30d preset spans last 30 calendar days inclusive", () => {
    expect(resolvePreset("30d", undefined, NOW)).toEqual({ from: "2026-06-16", to: "2026-07-15" });
  });

  it("current_month preset starts on 1st and ends today", () => {
    expect(resolvePreset("current_month", undefined, NOW)).toEqual({ from: "2026-07-01", to: "2026-07-15" });
  });

  it("previous_month preset spans the entire prior month", () => {
    expect(resolvePreset("previous_month", undefined, NOW)).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("previous_month handles year boundary", () => {
    const jan = new Date("2026-01-10T12:00:00Z");
    expect(resolvePreset("previous_month", undefined, jan)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});
