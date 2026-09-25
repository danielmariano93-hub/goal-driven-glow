import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Nino provider smoke — model authority", () => {
  it("tests the active ConversationBrain on the same primary model as AgentCoreV2", () => {
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    const smoke = readFileSync("scripts/nino_conversation_provider_smoke.ts", "utf8");

    expect(core).toContain('const BRAIN_MODEL = "openai/gpt-oss-120b"');
    expect(smoke).toContain('const model = Deno.env.get("NINO_AI_MODEL")');
    expect(smoke).toContain("v2_semantic_authority: model");

    const conversationCall = smoke.match(/interpretConversationTurn\(\{[\s\S]*?\n\}\);/)?.[0] ?? "";
    expect(conversationCall).toContain("model,");
    expect(conversationCall).not.toContain("model: fastModel");
  });

  it("uses the fast model only for a bounded strict-transport compatibility probe", () => {
    const smoke = readFileSync("scripts/nino_conversation_provider_smoke.ts", "utf8");

    expect(smoke).toContain("callStructuredFunction({");
    expect(smoke).toContain("model: fastModel");
    expect(smoke).toContain('name: "emit_strict_transport_probe"');
    expect(smoke).not.toContain("interpretSemanticTurnV3");
  });

  it("surfaces deterministic contract reason codes without writing smoke telemetry to production", () => {
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
