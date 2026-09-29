import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveExplicitPeriodPt } from "../../supabase/functions/_shared/analytics/explicitPeriodResolver";

const NOW = new Date("2026-09-28T15:00:00-03:00");

describe("Nino V3 live human-followup regressions", () => {
  it.each([
    "2026-09-21..2026-09-27",
    "2026-09-21/2026-09-27",
    "2026-09-21 to 2026-09-27",
    "2026-09-21 through 2026-09-27",
    "21/09/2026 a 27/09/2026",
    "21/09/2026 to 27/09/2026",
    "21/09 to 27/09",
    "do dia 21 ao dia 27",
    "semana passada do dia 21 ao dia 27",
  ])("normalizes deterministic date-range representation '%s'", (expression) => {
    expect(resolveExplicitPeriodPt(expression, NOW)).toMatchObject({
      from: "2026-09-21",
      to: "2026-09-27",
    });
  });

  it("keeps technical semantic failures from poisoning verified conversational state", () => {
    const source = readFileSync(
      "supabase/functions/_shared/agent/core/ConversationAuthority.ts",
      "utf8",
    );
    expect(source).toContain("semantic_follow_up_policy");
    expect(source).toContain('act: "conversational"');
    expect(source).toContain("inherit_focus: false");
    expect(source).toContain("provider/schema");
  });
});
