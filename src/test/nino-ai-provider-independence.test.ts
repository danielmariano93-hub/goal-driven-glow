import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { interpret } from "../../supabase/functions/_shared/agent/parser";

// Provider selection lives in ai-runtime; production call sites must not depend on Lovable AI.
describe("Nino AI provider independence", () => {
  it("uses one stable structured-call adapter for understanding and semantic compilation", () => {
    const structuredFiles = [
      "supabase/functions/_shared/agent/core/ConversationBrain.ts",
      "supabase/functions/_shared/agent/core/SemanticCompiler.ts",
      "supabase/functions/_shared/agent/core/HumanUnderstanding.ts",
    ];
    for (const path of structuredFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("resolveAiProvider()");
      expect(source, path).toContain("callStructuredFunction");
      expect(source, path).not.toContain('aiEndpoint(provider, "responses")');
      expect(source, path).not.toContain("ai.gateway.lovable.dev");
      expect(source, path).not.toContain('Deno.env.get("LOVABLE_API_KEY")');
    }

    const adapter = readFileSync("supabase/functions/_shared/ai-structured.ts", "utf8");
    expect(adapter).toContain('aiEndpoint(args.provider, "chat/completions")');
    expect(adapter).toContain('tool_choice');
    expect(adapter).toContain('function: { name: args.tool.name }');
    expect(adapter).toContain("safeAiErrorDetail");
  });

  it("keeps direct chat call sites provider-neutral", () => {
    const chatFiles = [
      "supabase/functions/_shared/agent/llm.ts",
      "supabase/functions/_shared/agent/core/Conversational.ts",
      "supabase/functions/_shared/agent/narrative/NarrativeComposer.ts",
    ];
    for (const path of chatFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("resolveAiProvider()");
      expect(source, path).toContain('aiEndpoint(provider, "chat/completions")');
      expect(source, path).toContain("normalizeAiModel");
      expect(source, path).not.toContain("ai.gateway.lovable.dev");
      expect(source, path).not.toContain('Deno.env.get("LOVABLE_API_KEY")');
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
      "supabase/functions/_shared/ai-structured.ts",
    ];
    for (const path of paths) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("ai.gateway.lovable.dev");
      expect(source, path).not.toContain('Deno.env.get("LOVABLE_API_KEY")');
      expect(source, path).not.toContain("createLovableAiGatewayProvider");
    }
  });

  it("does not put the Conversation Brain or Semantic Compiler on beta Responses transport", () => {
    for (const path of [
      "supabase/functions/_shared/agent/core/ConversationBrain.ts",
      "supabase/functions/_shared/agent/core/SemanticCompiler.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("chat_completions_structured");
      expect(source, path).not.toContain('"responses"');
      expect(source, path).not.toContain("response.function_call_arguments");
    }
  });

  it("does not confuse explicit cancellation with conversational repair", () => {
    expect(interpret("não, cancela").kind).toBe("cancel");
    expect(interpret("cancela por favor").kind).toBe("cancel");
    expect(interpret("não foi isso que te pedi").kind).toBe("unknown");
    expect(interpret("não era isso").kind).toBe("unknown");
  });
});
