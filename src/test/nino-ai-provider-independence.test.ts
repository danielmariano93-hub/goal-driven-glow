import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { interpret } from "../../supabase/functions/_shared/agent/parser";

// Provider selection lives in ai-runtime; production call sites must not depend on Lovable AI.
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
    expect(gateway).toContain("createAiGatewayProvider");
    expect(gateway).not.toContain("createLovableAiGatewayProvider");
  });

  it("requires an explicit provider and has no Lovable fallback", () => {
    const runtime = readFileSync("supabase/functions/_shared/ai-runtime.ts", "utf8");
    expect(runtime).toContain('requested === "openai"');
    expect(runtime).toContain('requested === "groq"');
    expect(runtime).toContain('"openrouter"].includes(requested)');
    expect(runtime).toContain("OPENAI_API_KEY");
    expect(runtime).toContain("GROQ_API_KEY");
    expect(runtime).toContain("OPENROUTER_API_KEY");
    expect(runtime).toContain("https://api.groq.com/openai/v1");
    expect(runtime).toContain("https://openrouter.ai/api/v1");
    expect(runtime).toContain("adaptResponsesBody");
    expect(runtime).not.toContain("LOVABLE_API_KEY");
    expect(runtime).not.toContain('provider: "lovable"');
    expect(runtime).not.toContain("ai.gateway.lovable.dev");
    expect(runtime).not.toContain("@ai-sdk/openai-compatible");
  });

  it("keeps every auxiliary AI workload Lovable-free", () => {
    const paths = [
      "supabase/functions/category-engine/index.ts",
      "supabase/functions/insights-generate/index.ts",
      "supabase/functions/financial-reports-generate/index.ts",
      "supabase/functions/assistant-ingest-document/index.ts",
      "supabase/functions/native-audio-transcribe/index.ts",
      "supabase/functions/_shared/messaging/wahaMedia.ts",
      "supabase/functions/_shared/agent/narrative/NarrativeComposer.ts",
      "supabase/functions/_shared/ai-gateway.ts",
      "supabase/functions/_shared/ai-runtime.ts",
    ];
    for (const path of paths) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("ai.gateway.lovable.dev");
      expect(source, path).not.toContain('Deno.env.get("LOVABLE_API_KEY")');
      expect(source, path).not.toContain("createLovableAiGatewayProvider");
    }
  });

  it("isolates Groq Responses incompatibilities in the provider adapter", () => {
    const runtime = readFileSync("supabase/functions/_shared/ai-runtime.ts", "utf8");
    expect(runtime).toContain('config.provider === "groq"');
    expect(runtime).toContain("delete adapted.include");
    expect(runtime).toContain("delete adapted.store");
    expect(runtime).toContain("delete adapted.previous_response_id");
    expect(runtime).toContain("delete adapted.truncation");

    const brain = readFileSync("supabase/functions/_shared/agent/core/ConversationBrain.ts", "utf8");
    expect(brain).toContain("adaptResponsesBody(provider");
    expect(brain).toContain("provider_override");
  });

  it("does not confuse explicit cancellation with conversational repair", () => {
    expect(interpret("não, cancela").kind).toBe("cancel");
    expect(interpret("cancela por favor").kind).toBe("cancel");
    expect(interpret("não foi isso que te pedi").kind).toBe("unknown");
    expect(interpret("não era isso").kind).toBe("unknown");
  });
});
