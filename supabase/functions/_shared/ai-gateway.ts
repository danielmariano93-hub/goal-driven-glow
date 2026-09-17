import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible";
import type { AiProviderConfig } from "./ai-runtime.ts";

export {
  aiEndpoint,
  aiJsonHeaders,
  normalizeAiModel,
  resolveAiProvider,
} from "./ai-runtime.ts";
export type { AiProviderConfig, AiProviderName } from "./ai-runtime.ts";

/**
 * Provider-neutral adapter for workloads that use the Vercel AI SDK.
 * Provider selection, base URL, credentials and model overrides are resolved
 * centrally by ai-runtime.ts so feature code never hardcodes a vendor.
 */
export function createAiSdkProvider(config: AiProviderConfig) {
  return createOpenAICompatible({
    name: `nino-${config.provider}`,
    baseURL: config.baseUrl,
    headers: config.headers,
  });
}

/** @deprecated Prefer resolveAiProvider + createAiSdkProvider. */
export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable-ai",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}
