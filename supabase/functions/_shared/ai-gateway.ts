import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export {
  aiEndpoint,
  aiJsonHeaders,
  normalizeAiModel,
  resolveAiProvider,
} from "./ai-runtime.ts";
export type { AiProviderConfig, AiProviderName } from "./ai-runtime.ts";

export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable-ai",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}
