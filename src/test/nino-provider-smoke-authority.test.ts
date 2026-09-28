import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Nino provider smoke — model authority", () => {
  it("keeps production authority on the same typed V3 contract across fast/deep model tiers", () => {
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    const authority = readFileSync("supabase/functions/_shared/agent/core/ConversationAuthority.ts", "utf8");
    const semanticAuthority = readFileSync("supabase/functions/_shared/agent/v3/SemanticAuthorityV3.ts", "utf8");
    const smoke = readFileSync("scripts/nino_conversation_provider_smoke.ts", "utf8");

    expect(core).toContain('const BRAIN_MODEL = "openai/gpt-oss-120b"');
    expect(authority).toContain("interpretWithSingleSemanticAuthorityV3");
    expect(authority).not.toContain("v3-circuit-breaker:");
    expect(semanticAuthority).toContain('envValue("NINO_AI_FAST_MODEL")');
    expect(semanticAuthority).toContain('envValue("NINO_AI_MODEL")');
    expect(semanticAuthority).toContain('"openai/gpt-oss-20b"');
    expect(semanticAuthority).toContain('"openai/gpt-oss-120b"');
    expect(smoke).toContain('const model = Deno.env.get("NINO_AI_MODEL")');
    expect(smoke).toContain("v3_semantic_authority: model");

    const v3Calls = smoke.match(/interpretSemanticTurnV3\(\{[\s\S]*?\n\s*\}\);/g) ?? [];
    expect(v3Calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a bounded fast-model transport probe without making it a language authority", () => {
    const smoke = readFileSync("scripts/nino_conversation_provider_smoke.ts", "utf8");
    const structured = readFileSync("supabase/functions/_shared/ai-structured.ts", "utf8");

    expect(smoke).toContain("callStructuredFunction({");
    expect(smoke).toContain("model: fastModel");
    expect(smoke).toContain('name: "emit_strict_transport_probe"');
    expect(structured).toContain('NINO_SEMANTIC_V3_TOOL = "emit_nino_turn_spec_v3"');
    expect(structured).toContain("defaultAttempts = args.tool.name === NINO_SEMANTIC_V3_TOOL ? 1");
  });

  it("retains legacy diagnostic capture only as observability, not as V3 semantic fallback", () => {
    const smoke = readFileSync("scripts/nino_conversation_provider_smoke.ts", "utf8");
    const authority = readFileSync("supabase/functions/_shared/agent/core/ConversationAuthority.ts", "utf8");

    expect(smoke).toContain("capturedContractInvalidReasons");
    expect(smoke).toContain('table === "ai_usage_ledger"');
    expect(smoke).toContain('row?.error_code === "conversation_brain_contract_invalid"');
    expect(smoke).toContain("metadata?.contract_invalid_reasons");
    expect(smoke).not.toContain("createClient(");

    expect(authority).not.toContain("circuitBreakerTelemetry");
    expect(authority).not.toContain("using circuit breaker");
  });
});