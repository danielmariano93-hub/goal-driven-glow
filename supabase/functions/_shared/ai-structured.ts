// Provider-neutral structured output helper for Nino's semantic layers.
// deno-lint-ignore-file no-explicit-any
import {
  aiEndpoint, aiJsonHeaders, normalizeAiModel, resolveAiFailoverProvider,
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
  attempts?: number;
  failover_from?: AiProviderConfig["provider"] | null;
};

const MAX_STRUCTURED_ATTEMPTS = 3;
const MAX_PROVIDER_RETRY_WAIT_MS = 10_000;
const CONVERSATION_BRAIN_TOOL = "emit_conversation_turn_contract";

export function safeAiErrorDetail(raw: string): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  let candidate = text;
  try {
    const parsed = JSON.parse(text);
    const error = parsed?.error ?? parsed;
    candidate = [error?.type, error?.code, error?.param, error?.message].filter(Boolean).join(": ");
  } catch { /* plain text */ }
  return candidate
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(?:gsk_|sk-)[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/\s+/g, " ").slice(0, 320) || null;
}

function useNativeStructuredOutput(args: { provider: AiProviderConfig; tool: StructuredFunctionSpec }): boolean {
  return args.provider.provider === "groq";
}

function normalizeConversationBrainArguments(argumentsText: string): string {
  try {
    const payload = JSON.parse(argumentsText);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return argumentsText;
    if (Array.isArray(payload.financial_read)) {
      if (payload.financial_read.length === 1 && payload.financial_read[0]
        && typeof payload.financial_read[0] === "object" && !Array.isArray(payload.financial_read[0])) {
        payload.financial_read = payload.financial_read[0];
      } else if (payload.financial_read.length === 0 && payload.domain !== "financial_read") {
        payload.financial_read = null;
      }
    }
    return JSON.stringify(payload);
  } catch { return argumentsText; }
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

function boundedRetryDelayMs(args: { response: Response; raw: string; attempt: number; maxAttempts: number }): number | null {
  const { response, raw, attempt, maxAttempts } = args;
  if (response.status === 400 && attempt < maxAttempts
    && /output_parse_failed|tool_use_failed|failed_generation|generated json does not match|json_validate_failed/i.test(raw)) return 0;
  if (response.status === 429) {
    const providerDelay = retryAfterMs(response);
    const delay = providerDelay ?? Math.min(1_000 * (2 ** Math.max(0, attempt - 1)), 4_000);
    return delay <= MAX_PROVIDER_RETRY_WAIT_MS ? delay : null;
  }
  if ([500, 502, 503, 504].includes(response.status)) return Math.min(400 * (2 ** Math.max(0, attempt - 1)), 2_000);
  return null;
}

function shouldFailover(status: number | null, detail: string | null, errorCode: string | null): boolean {
  if (status == null) return errorCode === "structured_call_network_error";
  if (status === 429 || [500, 502, 503, 504].includes(status)) return true;
  if (status === 400) {
    return /output_parse_failed|tool_use_failed|failed_generation|generated json does not match|json_validate_failed/i.test(detail ?? "");
  }
  return false;
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
  /** Override retry budget. Semantic authority uses 1 so it can change tier/provider instead of retrying blindly. */
  max_attempts?: number;
  /** Internal guard: public callers should leave this unset. */
  disable_failover?: boolean;
}): Promise<StructuredCallResult> {
  const started = Date.now();
  const model = normalizeAiModel(args.model, args.provider);
  const nativeStructuredOutput = useNativeStructuredOutput(args);
  const conversationBrainOutput = nativeStructuredOutput && args.tool.name === CONVERSATION_BRAIN_TOOL;
  const failover = args.disable_failover ? null : resolveAiFailoverProvider();
  const hasDistinctFailover = Boolean(failover && (
    failover.provider !== args.provider.provider
    || String(failover.modelOverride ?? "") !== String(args.provider.modelOverride ?? "")
  ));
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: args.system }, { role: "user", content: args.user }],
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
    body.tools = [{ type: "function", function: {
      name: args.tool.name, description: args.tool.description,
      parameters: args.tool.parameters,
      ...(args.tool.strict === undefined ? {} : { strict: args.tool.strict }),
    } }];
    body.tool_choice = { type: "function", function: { name: args.tool.name } };
  }

  if (args.provider.provider === "groq" && /openai\/gpt-oss-(?:20b|120b)/i.test(model)) {
    body.reasoning_effort = args.reasoning_effort ?? "low";
  }

  const maxAttempts = Math.max(1, Math.min(MAX_STRUCTURED_ATTEMPTS, Number(args.max_attempts ?? MAX_STRUCTURED_ATTEMPTS) || 1));
  let response: Response | null = null;
  let raw = "";
  let json: any = null;
  let attempts = 0;
  let networkErrorCode: string | null = null;
  let networkErrorDetail: string | null = null;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      response = await fetch(aiEndpoint(args.provider, "chat/completions"), {
        method: "POST", headers: aiJsonHeaders(args.provider), body: JSON.stringify(body), signal: args.signal,
      });
      networkErrorCode = null;
      networkErrorDetail = null;
    } catch (error) {
      networkErrorCode = (error as { name?: string })?.name === "AbortError"
        ? "structured_call_timeout" : "structured_call_network_error";
      networkErrorDetail = safeAiErrorDetail(String((error as Error)?.message ?? error));
      break;
    }

    raw = await response.text();
    json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }

    // A configured secondary provider is useful only if there is enough time to
    // reach it. Rate limits usually persist longer than this turn's deadline, so
    // do not burn the deadline retrying the same provider first.
    if (!response.ok && response.status === 429 && hasDistinctFailover) break;

    if (!response.ok && attempts < maxAttempts) {
      const delay = boundedRetryDelayMs({ response, raw, attempt: attempts, maxAttempts });
      if (delay !== null) {
        const mayRetry = await waitForRetry(delay, args.signal);
        if (mayRetry) continue;
      }
    }
    break;
  }

  if (networkErrorCode || !response || !response.ok || !json) {
    const status = response?.status ?? null;
    const errorCode = networkErrorCode ?? `structured_call_gateway_${status || "bad_json"}`;
    const detail = networkErrorDetail ?? safeAiErrorDetail(raw);
    if (!args.disable_failover && !args.signal?.aborted && hasDistinctFailover && failover
      && shouldFailover(status, detail, errorCode)) {
      const secondary = await callStructuredFunction({ ...args, provider: failover, disable_failover: true });
      return {
        ...secondary,
        attempts: attempts + (secondary.attempts ?? 1),
        latency_ms: Date.now() - started,
        failover_from: args.provider.provider,
      };
    }
    return {
      ok: false, status, provider: args.provider.provider, model,
      arguments: "", body: json, input_tokens: 0, output_tokens: 0,
      latency_ms: Date.now() - started, error_code: errorCode,
      error_detail: detail, attempts, failover_from: null,
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
      ok: false, status: response.status || 200, provider: args.provider.provider, model,
      arguments: "", body: json, input_tokens: inputTokens, output_tokens: outputTokens,
      latency_ms: Date.now() - started,
      error_code: nativeStructuredOutput ? "structured_call_missing_structured_output" : "structured_call_missing_tool_call",
      error_detail: null, attempts, failover_from: null,
    };
  }

  if (conversationBrainOutput) functionArguments = normalizeConversationBrainArguments(functionArguments);
  return {
    ok: true, status: response.status || 200, provider: args.provider.provider, model,
    arguments: functionArguments, body: json, input_tokens: inputTokens, output_tokens: outputTokens,
    latency_ms: Date.now() - started, error_code: null, error_detail: null, attempts, failover_from: null,
  };
}