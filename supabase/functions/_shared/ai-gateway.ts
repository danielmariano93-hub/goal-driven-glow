import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible";
import type { AiProviderConfig } from "./ai-runtime.ts";

export {
  aiEndpoint,
  aiJsonHeaders,
  normalizeAiModel,
  resolveAiProvider,
} from "./ai-runtime.ts";
export type { AiProviderConfig, AiProviderName } from "./ai-runtime.ts";

/** Provider-neutral adapter for AI SDK call sites. */
export function createAiGatewayProvider(config: AiProviderConfig) {
  return createOpenAICompatible({
    name: `nino-${config.provider}`,
    baseURL: config.baseUrl,
    headers: config.headers,
  });
}
