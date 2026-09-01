// Centralized Lovable AI usage ledger. Best-effort only: telemetry must never
// break the user-facing or worker path.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type AiWorkload =
  | "AGENT_CONVERSATION"
  | "CATEGORY_BACKGROUND"
  | "CATEGORY_ONDEMAND"
  | "DOCUMENT_INGEST"
  | "PROACTIVE"
  | "INSIGHTS"
  | "ADVISOR_REPORTS"
  | "AUDIO_TRANSCRIPTION_APP"
  | "AUDIO_TRANSCRIPTION_WHATSAPP"
  | "ANTICIPATION"
  | "OTHER_AI";

export type AiUsageEvent = {
  workload: AiWorkload;
  function_name: string;
  operation?: string;
  user_id?: string | null;
  run_id?: string | null;
  model?: string | null;
  provider?: string | null;
  operation_type?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cached_tokens?: number | null;
  estimated_cost_usd?: number | null;
  provider_cost_usd?: number | null;
  success?: boolean;
  http_status?: number | null;
  error_code?: string | null;
  latency_ms?: number | null;
  batch_size?: number | null;
  unique_items?: number | null;
  idempotency_key?: string | null;
  retry_number?: number | null;
  reason_for_ai_call?: string | null;
  prompt_hash?: string | null;
  payload_bytes?: number | null;
  metadata?: Record<string, unknown> | null;
};

export function estimateAiCostUsd(model: string | null | undefined, inputTokens = 0, outputTokens = 0): number {
  const m = String(model ?? "");
  const [per1KIn, per1KOut] =
      /flash-lite|gpt-5(\.\d)?-nano|gpt-5\.4-nano/.test(m) ? [0.0001, 0.0004]
    : /gemini-3(\.\d)?-flash|gemini-2\.5-flash/.test(m) ? [0.0003, 0.0012]
    : /gpt-5(\.\d)?-mini|gpt-5\.4-mini/.test(m) ? [0.0004, 0.0016]
    : /pro-preview|gemini-2\.5-pro/.test(m) ? [0.0013, 0.0100]
    : /gpt-5\.6|gpt-5\.5|gpt-5\.4|gpt-5\b/.test(m) ? [0.0013, 0.0100]
    : /transcribe|audio/.test(m) ? [0.0006, 0.0000]
    : [0.0010, 0.0040];
  return +(inputTokens / 1000 * per1KIn + outputTokens / 1000 * per1KOut).toFixed(6);
}

export type GatewayUsageRead = {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  /** `false` quando o provedor não devolveu uso — a tela mostra "uso não informado". */
  reported: boolean;
};

/** Lê o uso real da resposta do gateway (chat completions e responses). Nunca estima. */
// deno-lint-ignore no-explicit-any
export function readGatewayUsage(json: any): GatewayUsageRead {
  const u = json?.usage ?? json?.response?.usage ?? null;
  const inTok = Number(u?.prompt_tokens ?? u?.input_tokens ?? 0);
  const outTok = Number(u?.completion_tokens ?? u?.output_tokens ?? 0);
  const cached = Number(u?.prompt_tokens_details?.cached_tokens ?? u?.input_tokens_details?.cached_tokens ?? 0);
  const reported = (Number.isFinite(inTok) && inTok > 0) || (Number.isFinite(outTok) && outTok > 0);
  return {
    input_tokens: Number.isFinite(inTok) && inTok > 0 ? Math.floor(inTok) : 0,
    output_tokens: Number.isFinite(outTok) && outTok > 0 ? Math.floor(outTok) : 0,
    cached_tokens: Number.isFinite(cached) && cached > 0 ? Math.floor(cached) : 0,
    reported,
  };
}

/**
 * Registro obrigatório de uma chamada ao gateway: tokens, latência e modelo
 * reais tirados da resposta. Quando o provedor não informa uso (áudio, por
 * exemplo), a linha entra com `usage_reported: false` em vez de número inventado.
 */
export async function recordGatewayCall(
  sb: SupabaseClient,
  event: Omit<AiUsageEvent, "input_tokens" | "output_tokens" | "cached_tokens">,
  responseJson: unknown,
): Promise<void> {
  const usage = readGatewayUsage(responseJson);
  await recordAiUsage(sb, {
    ...event,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cached_tokens: usage.cached_tokens,
    metadata: { ...(event.metadata ?? {}), usage_reported: usage.reported },
  });
}

export async function recordAiUsage(sb: SupabaseClient, event: AiUsageEvent): Promise<void> {

  try {
    const inputTokens = Math.max(0, Math.floor(Number(event.input_tokens ?? 0)));
    const outputTokens = Math.max(0, Math.floor(Number(event.output_tokens ?? 0)));
    const estimated = event.estimated_cost_usd ?? estimateAiCostUsd(event.model, inputTokens, outputTokens);
    await sb.from("ai_usage_ledger").insert({
      workload: event.workload,
      function_name: event.function_name,
      operation: event.operation ?? "unknown",
      user_id: event.user_id ?? null,
      run_id: event.run_id ?? null,
      model: event.model ?? null,
      provider: event.provider ?? "lovable_ai",
      operation_type: event.operation_type ?? "chat",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: Math.max(0, Math.floor(Number(event.cached_tokens ?? 0))),
      estimated_cost_usd: estimated,
      provider_cost_usd: event.provider_cost_usd ?? null,
      success: event.success ?? true,
      http_status: event.http_status ?? null,
      error_code: event.error_code ?? null,
      latency_ms: event.latency_ms == null ? null : Math.max(0, Math.floor(Number(event.latency_ms))),
      batch_size: Math.max(0, Math.floor(Number(event.batch_size ?? 1))),
      unique_items: Math.max(0, Math.floor(Number(event.unique_items ?? 1))),
      idempotency_key: event.idempotency_key ?? null,
      retry_number: Math.max(0, Math.floor(Number(event.retry_number ?? 0))),
      reason_for_ai_call: event.reason_for_ai_call ?? null,
      prompt_hash: event.prompt_hash ?? null,
      payload_bytes: event.payload_bytes == null ? null : Math.max(0, Math.floor(Number(event.payload_bytes))),
      metadata: event.metadata ?? {},
    });
  } catch (error) {
    console.warn("[ai-usage-ledger] write_failed", String(error).slice(0, 240));
  }
}
