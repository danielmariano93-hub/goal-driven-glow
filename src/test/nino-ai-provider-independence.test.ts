import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { interpret } from "../../supabase/functions/_shared/agent/parser";

describe("Nino AI provider independence", () => {
  it("keeps the Conversation Brain provider-neutral", () => {
    const brain = readFileSync("supabase/functions/_shared/agent/core/ConversationBrain.ts", "utf8");
    expect(brain).toContain("resolveAiProvider()");
    expect(brain).toContain('aiEndpoint(provider, "responses")');
    expect(brain).toContain("normalizeAiModel(input.model, provider)");
    expect(brain).not.toContain("ai.gateway.lovable.dev");
    expect(brain).not.toContain('Deno.env.get("LOVABLE_API_KEY")');
  });

  it("prefers direct OpenAI while retaining an explicit compatibility fallback", () => {
    const gateway = readFileSync("supabase/functions/_shared/ai-gateway.ts", "utf8");
    const openai = gateway.indexOf('provider: "openai"');
    const lovable = gateway.indexOf('provider: "lovable"');
    expect(openai).toBeGreaterThan(-1);
    expect(lovable).toBeGreaterThan(openai);
    expect(gateway).toContain("OPENAI_API_KEY");
    expect(gateway).toContain("NINO_AI_PROVIDER");
    expect(gateway).toContain('value.replace(/^openai\\//i, "")');
  });

  it("does not confuse explicit cancellation with conversational repair", () => {
    expect(interpret("não, cancela").kind).toBe("cancel");
    expect(interpret("cancela por favor").kind).toBe("cancel");
    expect(interpret("não foi isso que te pedi").kind).toBe("unknown");
    expect(interpret("não era isso").kind).toBe("unknown");
  });
});
