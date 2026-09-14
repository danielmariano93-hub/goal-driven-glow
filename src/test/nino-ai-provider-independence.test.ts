import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { interpret } from "../../supabase/functions/_shared/agent/parser";

describe("Nino AI provider independence", () => {
  it("keeps the V2 reasoning path provider-neutral", () => {
    const responsesFiles = [
      "supabase/functions/_shared/agent/core/ConversationBrain.ts",
      "supabase/functions/_shared/agent/core/SemanticCompiler.ts",
    ];
    for (const path of responsesFiles) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("resolveAiProvider()");
      expect(source).toContain('aiEndpoint(provider, "responses")');
      expect(source).toContain("normalizeAiModel(input.model, provider)");
      expect(source).not.toContain("ai.gateway.lovable.dev");
      expect(source).not.toContain('Deno.env.get("LOVABLE_API_KEY")');
    }

    const chatFiles = [
      "supabase/functions/_shared/agent/llm.ts",
      "supabase/functions/_shared/agent/core/HumanUnderstanding.ts",
      "supabase/functions/_shared/agent/core/Conversational.ts",
      "supabase/functions/_shared/agent/narrative/NarrativeComposer.ts",
    ];
    for (const path of chatFiles) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("resolveAiProvider()");
      expect(source).toContain('aiEndpoint(provider, "chat/completions")');
      expect(source).toContain("normalizeAiModel");
      expect(source).not.toContain("ai.gateway.lovable.dev");
      expect(source).not.toContain('Deno.env.get("LOVABLE_API_KEY")');
    }
  });

  it("uses direct OpenAI only when key and vetted model are configured", () => {
    const gateway = readFileSync("supabase/functions/_shared/ai-gateway.ts", "utf8");
    const openai = gateway.indexOf('provider: "openai"');
    const lovable = gateway.indexOf('provider: "lovable"');
    expect(openai).toBeGreaterThan(-1);
    expect(lovable).toBeGreaterThan(openai);
    expect(gateway).toContain("OPENAI_API_KEY");
    expect(gateway).toContain("NINO_AI_PROVIDER");
    expect(gateway).toContain("NINO_AI_MODEL");
    expect(gateway).toContain("if (!openAiKey || !openAiModel) return null");
    expect(gateway).toContain("config.modelOverride");
  });

  it("does not confuse explicit cancellation with conversational repair", () => {
    expect(interpret("não, cancela").kind).toBe("cancel");
    expect(interpret("cancela por favor").kind).toBe("cancel");
    expect(interpret("não foi isso que te pedi").kind).toBe("unknown");
    expect(interpret("não era isso").kind).toBe("unknown");
  });
});
