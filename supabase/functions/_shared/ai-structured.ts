// Provider-neutral structured function calling for Nino's semantic layers.
//
// Conversation understanding and Financial IR only need ONE structured result.
// Use the stable Chat Completions tool-calling contract instead of depending on
// provider-specific quirks in a beta Responses implementation.
// deno-lint-ignore-file no-explicit-any
import {
  aiEndpoint, aiJsonHeaders, normalizeAiModel,
  type AiProviderConfig,
} from "./ai-runtime.ts";

export type StructuredFunctionSpec = {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

export type StructuredCallResult = {
  ok: boolean;
  status: number | null;
  provider: AiProviderConfig["provider"];
  model: string;
  arguments: string;
  body: any;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  error_code: string | null;
  error_detail: string | null;
  /** Tentativas HTTP efetuadas. Parse failure do provedor pode ter 1 retry. */
  attempts?: number;
};

export function safeAiErrorDetail(raw: string): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  let candidate = text;
  try {
    const parsed = JSON.parse(text);
    const error = parsed?.error ?? parsed;
    candidate = [
      error?.type,
      error?.code,
      error?.param,
      error?.message,
    ].filter(Boolean).join(": ");
  } catch {
    // Upstream may return plain text.
  }
  return candidate
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(?:gsk_|sk-)[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 320) || null;
}

export async function callStructuredFunction(args: {
  provider: AiProviderConfig;
  model: string;
  system: string;
  user: string;
  tool: StructuredFunctionSpec;
  signal?: AbortSignal;
  temperature?: number;
  reasoning_effort?: "low" | "medium" | "high";
}): Promise<StructuredCallResult> {
  const started = Date.now();
  const model = normalizeAiModel(args.model, args.provider);
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    tools: [{
      type: "function",
      function: {
        name: args.tool.name,
        description: args.tool.description,
        parameters: args.tool.parameters,
        ...(args.tool.strict === undefined ? {} : { strict: args.tool.strict }),
      },
    }],
    tool_choice: {
      type: "function",
      function: { name: args.tool.name },
    },
    temperature: args.temperature ?? 0,
  };

  if (args.provider.provider === "groq" && /openai\/gpt-oss-(?:20b|120b)/i.test(model)) {
    body.reasoning_effort = args.reasoning_effort ?? "low";
  }

  let response: Response | null = null;
  let raw = "";
  let json: any = null;
  let attempts = 0;

  while (attempts < 2) {
    attempts += 1;
    try {
      response = await fetch(aiEndpoint(args.provider, "chat/completions"), {
        method: "POST",
        headers: aiJsonHeaders(args.provider),
        body: JSON.stringify(body),
        signal: args.signal,
      });
    } catch (error) {
      return {
        ok: false,
        status: null,
        provider: args.provider.provider,
        model,
        arguments: "",
        body: null,
        input_tokens: 0,
        output_tokens: 0,
        latency_ms: Date.now() - started,
        error_code: (error as { name?: string })?.name === "AbortError"
          ? "structured_call_timeout"
          : "structured_call_network_error",
        error_detail: safeAiErrorDetail(String((error as Error)?.message ?? error)),
        attempts,
      };
    }

    raw = await response.text();
    json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }

    // Groq/gpt-oss pode devolver 400 quando a geração não fecha o JSON do
    // tool-call (output_parse_failed). Isso é falha estocástica de geração,
    // não pedido inválido. Uma única nova amostra preserva a mesma semântica
    // sem cair para outro interpretador/rota.
    const retryableParseFailure = response.status === 400
      && /output_parse_failed|tool_use_failed|failed_generation/i.test(raw);
    if (retryableParseFailure && attempts < 2) continue;
    break;
  }

  if (!response || !response.ok || !json) {
    return {
      ok: false,
      status: response?.status || null,
      provider: args.provider.provider,
      model,
      arguments: "",
      body: json,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: Date.now() - started,
      error_code: `structured_call_gateway_${response?.status || "bad_json"}`,
      error_detail: safeAiErrorDetail(raw),
      attempts,
    };
  }

  const call = (json?.choices?.[0]?.message?.tool_calls ?? []).find(
    (item: any) => item?.type === "function" && item?.function?.name === args.tool.name,
  );
  const functionArguments = String(call?.function?.arguments ?? "");
  const usage = json?.usage ?? {};
  const inputTokens = Math.max(0, Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0);
  const outputTokens = Math.max(0, Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0);

  if (!functionArguments) {
    return {
      ok: false,
      status: response.status || 200,
      provider: args.provider.provider,
      model,
      arguments: "",
      body: json,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: Date.now() - started,
      error_code: "structured_call_missing_tool_call",
      error_detail: null,
      attempts,
    };
  }

  return {
    ok: true,
    status: response.status || 200,
    provider: args.provider.provider,
    model,
    arguments: functionArguments,
    body: json,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: Date.now() - started,
    error_code: null,
    error_detail: null,
    attempts,
  };
}
