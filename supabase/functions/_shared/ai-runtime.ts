export type AiProviderName = "openai" | "lovable" | "groq" | "openrouter";
export type AiProviderConfig = {
  provider: AiProviderName;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  modelOverride: string | null;
};

export type ResolveAiProviderOptions = {
  provider?: AiProviderName | string | null;
  model?: string | null;
};

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function envSnapshot(): Record<string, string | undefined> {
  return {
    NINO_AI_PROVIDER: Deno.env.get("NINO_AI_PROVIDER"),
    NINO_AI_BASE_URL: Deno.env.get("NINO_AI_BASE_URL"),
    NINO_AI_MODEL: Deno.env.get("NINO_AI_MODEL"),
    OPENAI_BASE_URL: Deno.env.get("OPENAI_BASE_URL"),
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
    LOVABLE_API_KEY: Deno.env.get("LOVABLE_API_KEY"),
    GROQ_API_KEY: Deno.env.get("GROQ_API_KEY"),
    GROQ_BASE_URL: Deno.env.get("GROQ_BASE_URL"),
    OPENROUTER_API_KEY: Deno.env.get("OPENROUTER_API_KEY"),
    OPENROUTER_BASE_URL: Deno.env.get("OPENROUTER_BASE_URL"),
  };
}

export function resolveAiProvider(
  env: Record<string, string | undefined> = envSnapshot(),
  options: ResolveAiProviderOptions = {},
): AiProviderConfig | null {
  // Product default remains Lovable. Every external provider is explicit opt-in:
  // merely having a key in the environment must never change production routing.
  const requested = String(options.provider ?? env.NINO_AI_PROVIDER ?? "").trim().toLowerCase();
  const requestedModel = String(options.model ?? env.NINO_AI_MODEL ?? "").trim();
  const openAiKey = String(env.OPENAI_API_KEY ?? "").trim();
  const lovableKey = String(env.LOVABLE_API_KEY ?? "").trim();
  const groqKey = String(env.GROQ_API_KEY ?? "").trim();
  const openRouterKey = String(env.OPENROUTER_API_KEY ?? "").trim();

  if (requested && !["openai", "lovable", "groq", "openrouter"].includes(requested)) return null;

  if (requested === "openai") {
    const model = requestedModel.replace(/^openai\//i, "");
    if (!openAiKey || !model) return null;
    return {
      provider: "openai",
      baseUrl: cleanBaseUrl(env.NINO_AI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
      apiKey: openAiKey,
      headers: { Authorization: `Bearer ${openAiKey}` },
      modelOverride: model,
    };
  }

  if (requested === "groq") {
    if (!groqKey || !requestedModel) return null;
    return {
      provider: "groq",
      baseUrl: cleanBaseUrl(env.NINO_AI_BASE_URL || env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"),
      apiKey: groqKey,
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Groq-Beta": "inference-metrics",
      },
      modelOverride: requestedModel,
    };
  }

  if (requested === "openrouter") {
    if (!openRouterKey || !requestedModel) return null;
    return {
      provider: "openrouter",
      baseUrl: cleanBaseUrl(env.NINO_AI_BASE_URL || env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"),
      apiKey: openRouterKey,
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        "X-Title": "Meu Nino",
      },
      modelOverride: requestedModel,
    };
  }

  // Lovable is authoritative whenever no other provider was explicitly requested.
  // This preserves the existing product/billing path while allowing shadow tests
  // and a future deliberate migration to a direct provider.
  if (lovableKey) {
    return {
      provider: "lovable",
      baseUrl: cleanBaseUrl(env.NINO_AI_BASE_URL || "https://ai.gateway.lovable.dev/v1"),
      apiKey: lovableKey,
      headers: {
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "edge-function",
      },
      modelOverride: null,
    };
  }

  return null;
}

export function aiEndpoint(config: AiProviderConfig, path: string): string {
  return `${config.baseUrl}/${String(path).replace(/^\/+/, "")}`;
}

export function aiJsonHeaders(config: AiProviderConfig): Record<string, string> {
  return { "Content-Type": "application/json", ...config.headers };
}

export function normalizeAiModel(model: string, config: AiProviderConfig): string {
  const value = String(model ?? "").trim();
  return String(config.modelOverride ?? value).trim();
}

/**
 * Normalizes an OpenAI Responses request for provider capability differences.
 * Groq currently rejects a few OpenAI fields even though the endpoint is largely
 * compatible. Keep those differences isolated here instead of spreading provider
 * conditionals through the Conversation Brain/Semantic Compiler.
 */
export function adaptResponsesBody(
  config: AiProviderConfig,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const adapted = { ...body };
  if (config.provider === "groq") {
    delete adapted.include;
    delete adapted.previous_response_id;
    delete adapted.truncation;
    delete adapted.safety_identifier;
    delete adapted.prompt_cache_key;
    delete adapted.prompt;
    // Groq accepts only false/null for store in Responses. Omitting it keeps the
    // request compatible while preserving the Nino's stateless behavior.
    delete adapted.store;
  }
  return adapted;
}
