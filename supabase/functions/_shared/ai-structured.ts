// Provider-neutral structured output helper for Nino's semantic layers.
//
// Conversation understanding and Financial IR only need ONE structured result.
// For Groq, semantic-contract generation uses native Structured Outputs
// (response_format/json_schema) in both best-effort and strict modes. This avoids
// abusing tool calling as a serialization transport: HTTP 200 responses without a
// tool_calls array are valid model responses, but they are not valid contract
// transport. Real domain tools continue to be executed elsewhere by the agent
// runtime; this helper never executes a tool.
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
  /** HTTP attempts actually executed, including bounded provider retries. */
  attempts?: number;
};

const MAX_STRUCTURED_ATTEMPTS = 3;
const MAX_PROVIDER_RETRY_WAIT_MS = 10_000;

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

function useNativeStructuredOutput(args: {
  provider: AiProviderConfig;
  tool: StructuredFunctionSpec;
}): boolean {
  // Groq exposes JSON Schema mode for GPT-OSS in both best-effort and strict
  // variants. callStructuredFunction is an OUTPUT helper, not a real tool
  // executor, so native structured output is the canonical transport here.
  return args.provider.provider === "groq";
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);

  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - Date.now());
}

function boundedRetryDelayMs(args: {
  response: Response;
  raw: string;
  attempt: number;
}): number | null {
  const { response, raw, attempt } = args;

  // One extra sample for stochastic best-effort JSON/tool generation failures.
  if (
    response.status === 400
    && attempt < 2
    && /output_parse_failed|tool_use_failed|failed_generation|generated json does not match/i.test(raw)
  ) {
    return 0;
  }

  // Groq documents retry-after on 429. Respect it when the wait remains short
  // enough for an interactive agent. A longer window fails closed instead of
  // making users wait tens of seconds or hammering the provider prematurely.
  if (response.status === 429) {
    const providerDelay = retryAfterMs(response);
    const delay = providerDelay ?? Math.min(1_000 * (2 ** Math.max(0, attempt - 1)), 4_000);
    return delay <= MAX_PROVIDER_RETRY_WAIT_MS ? delay : null;
  }

  // Transient provider/gateway failures get a small bounded exponential retry.
  if ([500, 502, 503, 504].includes(response.status)) {
    return Math.min(400 * (2 ** Math.max(0, attempt - 1)), 2_000);
  }

  return null;
}

async function waitForRetry(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) return !signal?.aborted;
  if (signal?.aborted) return false;

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
  const nativeStructuredOutput = useNativeStructuredOutput(args);
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    temperature: args.temperature ?? 0,
  };

  if (nativeStructuredOutput) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: args.tool.name,
        ...(args.tool.description ? { description: args.tool.description } : {}),
        strict: args.tool.strict === true,
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

  while (attempts < MAX_STRUCTURED_ATTEMPTS) {
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

    if (!response.ok && attempts < MAX_STRUCTURED_ATTEMPTS) {
      const delay = boundedRetryDelayMs({ response, raw, attempt: attempts });
      if (delay !== null) {
        const mayRetry = await waitForRetry(delay, args.signal);
        if (mayRetry) continue;
      }
    }
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
  if (nativeStructuredOutput) {
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
      error_code: nativeStructuredOutput
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
