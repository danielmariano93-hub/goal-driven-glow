export type AiProviderName = "openai" | "lovable";
export type AiProviderConfig = {
  provider: AiProviderName;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  modelOverride: string | null;
};

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function resolveAiProvider(env: Record<string, string | undefined> = {
  NINO_AI_PROVIDER: Deno.env.get("NINO_AI_PROVIDER"),
  NINO_AI_BASE_URL: Deno.env.get("NINO_AI_BASE_URL"),
  NINO_AI_MODEL: Deno.env.get("NINO_AI_MODEL"),
  OPENAI_BASE_URL: Deno.env.get("OPENAI_BASE_URL"),
  OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
  LOVABLE_API_KEY: Deno.env.get("LOVABLE_API_KEY"),
}): AiProviderConfig | null {
  const requested = String(env.NINO_AI_PROVIDER ?? "").trim().toLowerCase();
  const openAiKey = String(env.OPENAI_API_KEY ?? "").trim();
  const openAiModel = String(env.NINO_AI_MODEL ?? "").trim().replace(/^openai\//i, "");
  const lovableKey = String(env.LOVABLE_API_KEY ?? "").trim();

  if (requested && requested !== "openai" && requested !== "lovable") return null;

  if (requested === "openai") {
    if (!openAiKey || !openAiModel) return null;
    return {
      provider: "openai",
      baseUrl: cleanBaseUrl(env.NINO_AI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
      apiKey: openAiKey,
      headers: { Authorization: `Bearer ${openAiKey}` },
      modelOverride: openAiModel,
    };
  }

  if (!requested && openAiKey && openAiModel) {
    return {
      provider: "openai",
      baseUrl: cleanBaseUrl(env.NINO_AI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
      apiKey: openAiKey,
      headers: { Authorization: `Bearer ${openAiKey}` },
      modelOverride: openAiModel,
    };
  }

  if ((requested === "lovable" || (!requested && lovableKey)) && lovableKey) {
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
  if (config.provider === "openai") return String(config.modelOverride ?? "").trim();
  return value;
}
