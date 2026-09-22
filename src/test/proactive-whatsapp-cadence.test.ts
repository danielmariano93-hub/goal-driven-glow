import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROACTIVE_WHATSAPP_MIN_INTERVAL_MS,
  evaluateProactiveWhatsappCadence,
} from "../../supabase/functions/_shared/intelligence/proactiveWhatsappCadence.ts";

const proactiveTick = readFileSync("supabase/functions/agent-proactive-tick/index.ts", "utf8");
const anticipationTick = readFileSync("supabase/functions/anticipation-tick/index.ts", "utf8");

describe("proactive WhatsApp cadence", () => {
  const now = new Date("2026-09-21T14:00:00.000Z");

  it("allows the first proactive message", () => {
    const decision = evaluateProactiveWhatsappCadence({ now });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("no_recent_message");
  });

  it("defers a different proactive message until two hours have elapsed", () => {
    const lastMessageAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const decision = evaluateProactiveWhatsappCadence({ now, lastMessageAt });
    expect(PROACTIVE_WHATSAPP_MIN_INTERVAL_MS).toBe(2 * 60 * 60 * 1000);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("whatsapp_global_cooldown");
    expect(decision.retryAt).toBe(new Date(new Date(lastMessageAt).getTime() + PROACTIVE_WHATSAPP_MIN_INTERVAL_MS).toISOString());
  });

  it("allows the next proactive message once the interval has elapsed", () => {
    const lastMessageAt = new Date(now.getTime() - PROACTIVE_WHATSAPP_MIN_INTERVAL_MS).toISOString();
    const decision = evaluateProactiveWhatsappCadence({ now, lastMessageAt });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("interval_elapsed");
  });

  it("lets a truly critical pending alert bypass the cadence", () => {
    const lastMessageAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const decision = evaluateProactiveWhatsappCadence({ now, lastMessageAt, hasCriticalPending: true });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("critical_bypass");
  });

  it("centralizes delivery in agent-proactive-tick and releases one suggestion per run", () => {
    expect(proactiveTick).toContain("loadProactiveWhatsappCadence");
    expect(proactiveTick).toContain("max: 1");
    expect(anticipationTick).not.toContain("dispatchSuggestions");
    expect(anticipationTick).toContain("entrega real é exclusiva do agent-proactive-tick");
  });
});
