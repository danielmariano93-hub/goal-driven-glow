import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { interpret } from "../../supabase/functions/_shared/agent/parser";

// Provider selection lives in ai-runtime; conversational call sites must not depend on the SDK gateway.
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

    const gateway = readFileSync("supabase/functions/_shared/ai-gateway.ts", "utf8");
    expect(gateway).toContain('from "./ai-runtime.ts"');
  });

  it("uses direct OpenAI only when key and vetted model are configured", () => {
    const runtime = readFileSync("supabase/functions/_shared/ai-runtime.ts", "utf8");
    const openai = runtime.indexOf('provider: "openai"');
    const lovable = runtime.indexOf('provider: "lovable"');
    expect(openai).toBeGreaterThan(-1);
    expect(lovable).toBeGreaterThan(openai);
    expect(runtime).toContain("OPENAI_API_KEY");
    expect(runtime).toContain("NINO_AI_PROVIDER");
    expect(runtime).toContain("NINO_AI_MODEL");
    expect(runtime).toContain("if (!openAiKey || !openAiModel) return null");
    expect(runtime).toContain("config.modelOverride");
    expect(runtime).not.toContain("@ai-sdk/openai-compatible");
  });

  it("does not confuse explicit cancellation with conversational repair", () => {
    expect(interpret("não, cancela").kind).toBe("cancel");
    expect(interpret("cancela por favor").kind).toBe("cancel");
    expect(interpret("não foi isso que te pedi").kind).toBe("unknown");
    expect(interpret("não era isso").kind).toBe("unknown");
  });
});
