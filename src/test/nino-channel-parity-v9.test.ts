import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appAdapter = readFileSync("supabase/functions/_shared/agent/core/adapters/AppAdapter.ts", "utf8");
const whatsappOrchestrator = readFileSync("supabase/functions/_shared/agent/orchestrator.ts", "utf8");
const weekdayTool = readFileSync("supabase/functions/_shared/intelligence/weekdayTool.ts", "utf8");
const patterns = readFileSync("supabase/functions/_shared/anticipation/patterns.ts", "utf8");

describe("Nino channel/behavior parity v9", () => {
  it("app e WhatsApp entram no mesmo AgentCore", () => {
    expect(appAdapter).toContain('import { handleTurn');
    expect(appAdapter).toContain('channel: "app"');
    expect(whatsappOrchestrator).toContain('import { handleTurn');
    expect(whatsappOrchestrator).toContain('channel: input.source === "simulator" ? "simulator" : "whatsapp"');
  });

  it("assessor e antecipação usam a mesma verdade semanal", () => {
    expect(weekdayTool).toContain("computeWeekdayPatternFromDailyFacts");
    expect(patterns).toContain("computeWeekdayPatternFromDailyFacts");
    expect(patterns).toContain("truth_decision");
  });
});
