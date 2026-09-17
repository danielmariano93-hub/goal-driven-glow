export type AiProviderName = "openai" | "groq" | "openrouter";
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
  // Provider selection is explicit. Production sets NINO_AI_PROVIDER=groq;
  // merely having another provider key in the environment must never reroute traffic.
  const requested = String(options.provider ?? env.NINO_AI_PROVIDER ?? "").trim().toLowerCase();
  const requestedModel = String(options.model ?? env.NINO_AI_MODEL ?? "").trim();
  const openAiKey = String(env.OPENAI_API_KEY ?? "").trim();
  const groqKey = String(env.GROQ_API_KEY ?? "").trim();
  const openRouterKey = String(env.OPENROUTER_API_KEY ?? "").trim();

  if (!requested || !["openai", "groq", "openrouter"].includes(requested)) return null;

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

export function aiEndpoint(config: AiProviderConfig, path: string): string {
  return `${config.baseUrl}/${String(path).replace(/^\/+/, "")}`;
}

export function aiJsonHeaders(config: AiProviderConfig): Record<string, string> {
  return { "Content-Type": "application/json", ...config.headers };
}

/**
 * Resolves a caller model into the configured provider's model namespace.
 * Provider-native specialist models (vision/audio) are preserved; legacy model
 * ids from the old gateway are replaced by NINO_AI_MODEL.
 */
export function normalizeAiModel(model: string, config: AiProviderConfig): string {
  const value = String(model ?? "").trim();
  if (config.provider === "groq") {
    if (/^(?:openai\/gpt-oss-(?:20b|120b)|qwen\/qwen3\.(?:6|8)-27b|whisper-large-v3(?:-turbo)?)$/i.test(value)) {
      return value;
    }
    return String(config.modelOverride ?? value).trim();
  }
  if (config.provider === "openai") {
    const selected = String(config.modelOverride ?? value).trim();
    return selected.replace(/^openai\//i, "");
  }
  return String(config.modelOverride ?? value).trim();
}

/**
 * Normalizes an OpenAI Responses request for provider capability differences.
 * Keep provider conditionals isolated here instead of spreading them through
 * the Conversation Brain/Semantic Compiler.
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
    delete adapted.store;
  }
  return adapted;
}
