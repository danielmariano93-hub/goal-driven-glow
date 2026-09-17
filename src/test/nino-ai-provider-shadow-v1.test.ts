import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rolloutDecision } from "../../supabase/functions/_shared/agent/core/FeatureFlags.ts";

describe("Nino AI provider shadow v1", () => {
  it("is fail-closed and starts at 0% rollout", () => {
    const migration = readFileSync("supabase/migrations/20260917090000_nino_ai_provider_shadow_v1.sql", "utf8");
    expect(migration).toContain("'ai_provider_shadow_v1', false, 0");
    expect(rolloutDecision("ai_provider_shadow_v1", "user-a", {
      enabled: false, rollout_percent: 100, pilot_user_ids: [],
    })).toBe(false);
    expect(rolloutDecision("ai_provider_shadow_v1", "user-a", {
      enabled: true, rollout_percent: 0, pilot_user_ids: [],
    })).toBe(false);
  });

  it("never changes the authoritative Conversation Brain contract", () => {
    const brain = readFileSync("supabase/functions/_shared/agent/core/ConversationBrain.ts", "utf8");
    expect(brain).toContain('isEnabled("ai_provider_shadow_v1"');
    expect(brain).toContain("provider_override");
    expect(brain).toContain("scheduleProviderShadow");
    expect(brain).toContain("EdgeRuntime");
    expect(brain).toContain("waitUntil");
    expect(brain).toContain("if (!input.provider_override");
    expect(brain).not.toContain("runTool(");
    expect(brain).not.toContain("executeBrainWriteTurn(");
  });

  it("restricts the free-provider experiment to Groq/OpenRouter", () => {
    const brain = readFileSync("supabase/functions/_shared/agent/core/ConversationBrain.ts", "utf8");
    expect(brain).toContain('NINO_SHADOW_AI_PROVIDER');
    expect(brain).toContain('NINO_SHADOW_AI_MODEL');
    expect(brain).toContain('["groq", "openrouter"]');
    expect(brain).toContain("shadow_provider_key_missing");
  });

  it("stores provider comparison telemetry as service-role-only operational data", () => {
    const migration = readFileSync("supabase/migrations/20260917090000_nino_ai_provider_shadow_v1.sql", "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.ai_provider_shadow_evaluations");
    expect(migration).toContain("same_act boolean");
    expect(migration).toContain("same_mode boolean");
    expect(migration).toContain("same_focus boolean");
    expect(migration).toContain("shadow_tokens_in");
    expect(migration).toContain("shadow_tokens_out");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.ai_provider_shadow_evaluations FROM authenticated, anon");
    expect(migration).toContain("GRANT ALL ON public.ai_provider_shadow_evaluations TO service_role");
  });

  it("provides an operational summary for quality, latency and token usage", () => {
    const migration = readFileSync("supabase/migrations/20260917090000_nino_ai_provider_shadow_v1.sql", "utf8");
    expect(migration).toContain("CREATE OR REPLACE VIEW public.ai_provider_shadow_summary");
    expect(migration).toContain("act_match_pct");
    expect(migration).toContain("mode_match_pct");
    expect(migration).toContain("focus_match_pct");
    expect(migration).toContain("avg_shadow_latency_ms");
    expect(migration).toContain("p95_shadow_latency_ms");
  });
});
