import { describe, expect, it } from "vitest";
import { discoverPatterns } from "../../supabase/functions/_shared/anticipation/patterns.ts";
import type { DailyFact, DetectorConfig, DetectorKey } from "../../supabase/functions/_shared/anticipation/contracts.ts";

const config: DetectorConfig = {
  detector: "weekday_spending_risk",
  enabled: true,
  min_sample: 4,
  min_uplift_pct: 20,
  min_absolute_delta: 5,
  min_hit_rate: 0.5,
  min_confidence: 0.5,
  min_coverage: 0.6,
} as unknown as DetectorConfig;

function day(date: string, weekday: number, total: number, exceptional = false): DailyFact {
  return {
    user_id: "u1",
    local_date: date,
    weekday,
    total_adjustable: total,
    is_exceptional_day: exceptional,
  } as unknown as DailyFact;
}

/** 12 semanas: segunda e sexta muito próximas, com um outlier gigante na segunda. */
function buildDays(mondayValue: number, fridayValue: number, withOutlier: boolean): DailyFact[] {
  const days: DailyFact[] = [];
  let cursor = 0;
  for (let week = 0; week < 12; week++) {
    for (let wd = 0; wd <= 6; wd++) {
      cursor += 1;
      const date = `2026-0${1 + Math.floor(cursor / 28)}-${String((cursor % 28) + 1).padStart(2, "0")}`;
      const outlier = withOutlier && wd === 1 && week === 0;
      const total = wd === 1 ? (outlier ? 4000 : mondayValue) : wd === 5 ? fridayValue : 20;
      days.push(day(date, wd, total));
    }
  }
  return days;
}

const configs = new Map<DetectorKey, DetectorConfig>([["weekday_spending_risk", config]]);

describe("weekday_spending_risk", () => {
  it("exclui outliers do cálculo do comportamento típico", () => {
    const withOutlier = discoverPatterns({ userId: "u1", days: buildDays(83.56, 79.35, true), coverage: 0.9, configs });
    const monday = withOutlier.find((p) => p.pattern_key === "weekday:1");
    expect(monday).toBeTruthy();
    // 4000 não pode contaminar o valor típico da segunda
    expect(monday!.pattern_value).toBeLessThan(200);
    expect(Number(monday!.evidence.excluded_outliers ?? 0)).toBeGreaterThan(0);
  });

  it("dias sem gasto entram no denominador (média/mediana por dia, não total acumulado)", () => {
    const days = buildDays(100, 20, false).map((d) => (d.weekday === 1 && d.local_date.endsWith("2") ? { ...d, total_adjustable: 0 } : d));
    const patterns = discoverPatterns({ userId: "u1", days: days as DailyFact[], coverage: 0.9, configs });
    const monday = patterns.find((p) => p.pattern_key === "weekday:1");
    expect(monday!.pattern_value).toBeLessThanOrEqual(100);
  });

  it("segunda e sexta muito próximas não geram padrão validado", () => {
    const patterns = discoverPatterns({ userId: "u1", days: buildDays(83.56, 79.35, false), coverage: 0.9, configs });
    const monday = patterns.find((p) => p.pattern_key === "weekday:1");
    expect(monday).toBeTruthy();
    expect(monday!.status).toBe("candidate");
    expect(JSON.stringify(monday!.evidence.block_reasons)).toContain("weekday_separation");
  });

  it("dia realmente destacado permanece validado", () => {
    const patterns = discoverPatterns({ userId: "u1", days: buildDays(200, 20, false), coverage: 0.9, configs });
    const monday = patterns.find((p) => p.pattern_key === "weekday:1");
    expect(monday!.status).toBe("validated");
  });
});
