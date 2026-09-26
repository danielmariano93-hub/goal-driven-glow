import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Nino provider smoke — model authority", () => {
  it("tests Runtime V3 on the same primary model used by production authority", () => {
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    const authority = readFileSync("supabase/functions/_shared/agent/core/ConversationAuthority.ts", "utf8");
    const smoke = readFileSync("scripts/nino_conversation_provider_smoke.ts", "utf8");

    expect(core).toContain('const BRAIN_MODEL = "openai/gpt-oss-120b"');
    expect(authority).toContain('const V3_MODEL = "openai/gpt-oss-120b"');
    expect(smoke).toContain('const model = Deno.env.get("NINO_AI_MODEL")');
    expect(smoke).toContain("v3_semantic_authority: model");
    expect(smoke).toContain("v2_circuit_breaker: model");

    const v3Calls = smoke.match(/interpretSemanticTurnV3\(\{[\s\S]*?\n\}\);/g) ?? [];
    expect(v3Calls.length).toBeGreaterThanOrEqual(2);
    for (const call of v3Calls) {
      expect(call).toContain("model,");
      expect(call).not.toContain("model: fastModel");
    }
  });

  it("uses the fast model only for a bounded strict-transport compatibility probe", () => {
    const smoke = readFileSync("scripts/nino_conversation_provider_smoke.ts", "utf8");

    expect(smoke).toContain("callStructuredFunction({");
    expect(smoke).toContain("model: fastModel");
    expect(smoke).toContain('name: "emit_strict_transport_probe"');
    expect(smoke).toContain("interpretSemanticTurnV3");
  });

  it("keeps V2 provider diagnostics available for the marked circuit breaker", () => {
    const smoke = readFileSync("scripts/nino_conversation_provider_smoke.ts", "utf8");

    expect(smoke).toContain("capturedContractInvalidReasons");
    expect(smoke).toContain('table === "ai_usage_ledger"');
    expect(smoke).toContain('row?.error_code === "conversation_brain_contract_invalid"');
    expect(smoke).toContain("metadata?.contract_invalid_reasons");
    expect(smoke).toContain("sb: diagnosticSink as any");
    expect(smoke).toContain('reasons=${JSON.stringify(capturedContractInvalidReasons)}');
    expect(smoke).not.toContain("createClient(");
  });
});
