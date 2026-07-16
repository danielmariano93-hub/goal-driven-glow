import { describe, it, expect } from "vitest";
import { nextOccurrences } from "@/lib/recurring/schedule";

describe("nextOccurrences", () => {
  it("mensal com dia 31 usa último dia em fevereiro", () => {
    const r = nextOccurrences(
      { frequency: "monthly", start_date: "2026-01-31", day_of_month: 31 },
      "2026-01-01",
      3,
    );
    expect(r[0]).toBe("2026-01-31");
    expect(r[1]).toBe("2026-02-28");
    expect(r[2]).toBe("2026-03-31");
  });

  it("semanal respeita weekday", () => {
    const r = nextOccurrences(
      { frequency: "weekly", start_date: "2026-01-05", weekday: 1 }, // segunda
      "2026-01-05",
      3,
    );
    expect(r).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });

  it("diária gera datas consecutivas", () => {
    const r = nextOccurrences(
      { frequency: "daily", start_date: "2026-01-01" },
      "2026-01-01",
      3,
    );
    expect(r).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("respeita end_date", () => {
    const r = nextOccurrences(
      { frequency: "monthly", start_date: "2026-01-15", end_date: "2026-02-15", day_of_month: 15 },
      "2026-01-01",
      5,
    );
    expect(r.length).toBeLessThanOrEqual(2);
  });
});
