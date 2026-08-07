import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

describe("single behavioral truth v9", () => {
  const activeEdgeSource = files("supabase/functions").map((p) => [p, readFileSync(p, "utf8")] as const);

  it("remove a fórmula semanal v4 do runtime ativo", () => {
    const offenders = activeEdgeSource.filter(([, src]) => src.includes("weekday.behavioral-date.v4"));
    expect(offenders.map(([p]) => p)).toEqual([]);
  });

  it("a versão v5 é definida em um único módulo canônico", () => {
    const definitions = activeEdgeSource.filter(([, src]) => src.includes('WEEKDAY_TRUTH_FORMULA_VERSION = "weekday.behavioral-truth.v5"'));
    expect(definitions.map(([p]) => p)).toEqual([
      "supabase/functions/_shared/analytics/weekdayTruth.ts",
    ]);
  });

  it("fatos de antecipação respeitam behavioral_day/confidence", () => {
    const src = readFileSync("supabase/functions/_shared/anticipation/facts.ts", "utf8");
    expect(src).toContain("resolveBehavioralDate(row)");
    expect(src).toContain("behaviorDate.eligibleForBehavior");
  });
});
