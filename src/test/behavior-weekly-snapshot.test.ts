import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { weekStartSP } from "../../supabase/functions/_shared/behavior/observedSnapshot";
import { weekStartOf } from "@/lib/behavioral/behaviorEvolution";

describe("job semanal do snapshot observado", () => {
  it("a semana do servidor é a mesma da tela", () => {
    for (const iso of ["2026-10-01T15:00:00Z", "2026-09-28T02:00:00Z", "2026-09-27T23:00:00Z", "2026-01-01T12:00:00Z"]) {
      expect(weekStartSP(new Date(iso))).toBe(weekStartOf(new Date(iso)));
    }
  });
  it("roda no estágio behavior do tick proativo e usa o motor espelhado", () => {
    const tick = readFileSync("supabase/functions/agent-proactive-tick/index.ts", "utf8");
    expect(tick).toContain("saveWeeklyObservedSnapshot(sb, uid)");
    const job = readFileSync("supabase/functions/_shared/behavior/observedSnapshot.ts", "utf8");
    expect(job).toContain("finance-core/behaviorObserved.ts");
    expect(job).toContain("behavioral_dashboard_snapshot_for_user");
    expect(job).toContain("MIN_COVERAGE = 3");
  });
});
