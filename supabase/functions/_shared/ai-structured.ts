// Provider-neutral structured output helper for Nino's semantic layers.
//
// Conversation understanding and Financial IR only need ONE structured result.
// Best-effort schemas use stable Chat Completions tool calling. For Groq strict
// schemas, use native Structured Outputs (response_format/json_schema): this
// gives constrained decoding without abusing a local function call as an output
// transport. The public result stays identical so semantic callers do not need
// provider-specific branches.
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

function useNativeStrictStructuredOutput(args: {
  provider: AiProviderConfig;
  tool: StructuredFunctionSpec;
}): boolean {
  // Groq supports constrained JSON-schema decoding for GPT-OSS. This path is
  // deliberately limited to strict schemas so existing V2 best-effort/tool-call
  // behavior remains untouched during the V3 migration.
  return args.provider.provider === "groq" && args.tool.strict === true;
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
  const nativeStrictOutput = useNativeStrictStructuredOutput(args);
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    temperature: args.temperature ?? 0,
  };

  if (nativeStrictOutput) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: args.tool.name,
        ...(args.tool.description ? { description: args.tool.description } : {}),
        strict: true,
        schema: args.tool.parameters,
      },
    };
  } else {
    body.tools = [{
      type: "function",
      function: {
        name: args.tool.name,
        description: args.tool.description,
        parameters: args.tool.parameters,
        ...(args.tool.strict === undefined ? {} : { strict: args.tool.strict }),
      },
    }];
    body.tool_choice = {
      type: "function",
      function: { name: args.tool.name },
    };
  }

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

    // Groq/gpt-oss can return 400 when best-effort tool generation does not
    // close valid JSON. This is stochastic generation failure, not a request
    // contract failure. Native strict Structured Outputs should not need this,
    // but keeping the retry predicate harmlessly covers transient gateway forms.
    const retryableParseFailure = response.status === 400
      && /output_parse_failed|tool_use_failed|failed_generation|generated json does not match/i.test(raw);
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

  const usage = json?.usage ?? {};
  const inputTokens = Math.max(0, Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0);
  const outputTokens = Math.max(0, Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0);

  let functionArguments = "";
  if (nativeStrictOutput) {
    functionArguments = String(json?.choices?.[0]?.message?.content ?? "");
  } else {
    const call = (json?.choices?.[0]?.message?.tool_calls ?? []).find(
      (item: any) => item?.type === "function" && item?.function?.name === args.tool.name,
    );
    functionArguments = String(call?.function?.arguments ?? "");
  }

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
      error_code: nativeStrictOutput
        ? "structured_call_missing_structured_output"
        : "structured_call_missing_tool_call",
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
