import { describe, expect, it } from "vitest";
import { computeWeekdayTruth, WEEKDAY_TRUTH_FORMULA_VERSION } from "../../supabase/functions/_shared/analytics/weekdayTruth";

function dateRange(from: string, to: string) {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function sparseFridays(values: number[]) {
  const fridays = dateRange("2026-05-15", "2026-08-07").filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5);
  return values.map((amount, index) => ({ date: fridays[index], amount, transactions: amount > 0 ? 1 : 0, confidence: 1 }));
}

describe("weekday behavioral truth v5", () => {
  it("reproduz o caso real que gerava R$ 782,30 e ABSTÉM em vez de afirmar padrão", () => {
    const result = computeWeekdayTruth({
      from: "2026-05-15",
      to: "2026-08-07",
      days: sparseFridays([21.90, 1396.02, 1043.07, 0]),
    });
    expect(result.formula_version).toBe(WEEKDAY_TRUTH_FORMULA_VERSION);
    expect(result.winner).toBeNull();
    expect(result.decision).toBe("insufficient");
    expect(result.candidate).toBeNull();
    expect(JSON.stringify(result)).not.toContain("782.3");
  });

  it("duas ocorrências nunca criam vencedor público", () => {
    const result = computeWeekdayTruth({
      from: "2026-05-01",
      to: "2026-06-30",
      days: sparseFridays([120, 150]),
    });
    expect(result.winner).toBeNull();
    expect(result.confidence).toBe("insufficient");
  });

  it("aceita uma sexta realmente estável e repetida", () => {
    const all = dateRange("2026-05-15", "2026-08-07");
    const fridayValues = [180, 190, 185, 200, 195, 205, 188, 198, 192, 202, 187, 197, 194];
    let fi = 0;
    const days = all.map((date) => {
      const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
      const amount = wd === 5 ? fridayValues[fi++] : (wd === 3 ? 60 : 25);
      return { date, amount, transactions: 1, confidence: 1 };
    });
    const result = computeWeekdayTruth({ from: "2026-05-15", to: "2026-08-07", days });
    expect(result.decision).toBe("established");
    expect(result.winner?.weekday).toBe(5);
    expect(result.winner?.typical_amount).toBeGreaterThan(170);
    expect(result.winner?.typical_amount).toBeLessThan(210);
  });

  it("dias líderes próximos retornam ambíguo, não uma conclusão", () => {
    const all = dateRange("2026-05-15", "2026-08-07");
    const days = all.map((date) => {
      const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
      const amount = wd === 1 ? 100 : wd === 5 ? 96 : 20;
      return { date, amount, transactions: 1, confidence: 1 };
    });
    const result = computeWeekdayTruth({ from: "2026-05-15", to: "2026-08-07", days });
    expect(result.decision).toBe("ambiguous");
    expect(result.winner).toBeNull();
    expect(result.candidate).not.toBeNull();
  });
});
