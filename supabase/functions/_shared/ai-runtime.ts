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

function envValue(name: string): string | undefined {
  // Edge Functions run on Deno, while Vitest/Node validates the same shared
  // module in CI. Keep environment access portable and side-effect free.
  const denoEnv = (globalThis as any)?.Deno?.env;
  if (denoEnv && typeof denoEnv.get === "function") return denoEnv.get(name) ?? undefined;
  const processEnv = (globalThis as any)?.process?.env;
  return processEnv ? processEnv[name] : undefined;
}

function envSnapshot(): Record<string, string | undefined> {
  return {
    NINO_AI_PROVIDER: envValue("NINO_AI_PROVIDER"),
    NINO_AI_BASE_URL: envValue("NINO_AI_BASE_URL"),
    NINO_AI_MODEL: envValue("NINO_AI_MODEL"),
    NINO_AI_FAILOVER_PROVIDER: envValue("NINO_AI_FAILOVER_PROVIDER"),
    NINO_AI_FAILOVER_MODEL: envValue("NINO_AI_FAILOVER_MODEL"),
    NINO_AI_FAILOVER_BASE_URL: envValue("NINO_AI_FAILOVER_BASE_URL"),
    OPENAI_BASE_URL: envValue("OPENAI_BASE_URL"),
    OPENAI_API_KEY: envValue("OPENAI_API_KEY"),
    GROQ_API_KEY: envValue("GROQ_API_KEY"),
    GROQ_BASE_URL: envValue("GROQ_BASE_URL"),
    OPENROUTER_API_KEY: envValue("OPENROUTER_API_KEY"),
    OPENROUTER_BASE_URL: envValue("OPENROUTER_BASE_URL"),
  };
}

export function resolveAiProvider(
  env: Record<string, string | undefined> = envSnapshot(),
  options: ResolveAiProviderOptions = {},
): AiProviderConfig | null {
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

/**
 * Optional real provider failover. It is deliberately opt-in: merely having a
 * second provider key never creates traffic/cost. Production must set both
 * NINO_AI_FAILOVER_PROVIDER and NINO_AI_FAILOVER_MODEL.
 */
export function resolveAiFailoverProvider(
  env: Record<string, string | undefined> = envSnapshot(),
): AiProviderConfig | null {
  const provider = String(env.NINO_AI_FAILOVER_PROVIDER ?? "").trim().toLowerCase();
  const model = String(env.NINO_AI_FAILOVER_MODEL ?? "").trim();
  if (!provider || !model) return null;
  const failEnv = {
    ...env,
    NINO_AI_PROVIDER: provider,
    NINO_AI_MODEL: model,
    // Never leak the primary provider's custom base URL into the secondary.
    NINO_AI_BASE_URL: env.NINO_AI_FAILOVER_BASE_URL || "",
  };
  const config = resolveAiProvider(failEnv, { provider, model });
  if (!config) return null;
  const primaryProvider = String(env.NINO_AI_PROVIDER ?? "").trim().toLowerCase();
  const primaryModel = String(env.NINO_AI_MODEL ?? "").trim().replace(/^openai\//i, "");
  const secondaryModel = String(config.modelOverride ?? "").trim().replace(/^openai\//i, "");
  if (config.provider === primaryProvider && secondaryModel === primaryModel) return null;
  return config;
}

export function aiEndpoint(config: AiProviderConfig, path: string): string {
  return `${config.baseUrl}/${String(path).replace(/^\/+/, "")}`;
}

export function aiJsonHeaders(config: AiProviderConfig): Record<string, string> {
  return { "Content-Type": "application/json", ...config.headers };
}

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