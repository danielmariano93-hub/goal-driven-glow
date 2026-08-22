// Observability — per-turn metrics collector. Stage timings, tool timings,
// token/cost estimates, counters. Writes are best-effort to keep the turn
// hot path lean.
// deno-lint-ignore-file no-explicit-any

export type StageName =
  | "session" | "intent" | "policy" | "plan"
  | "tools" | "validate" | "persist" | "total";

export type TurnMetrics = {
  channel: string;
  stages: Record<string, number>;
  tools: Array<{ name: string; duration_ms: number; ok: boolean; retries?: number }>;
  tokens_in: number;
  tokens_out: number;
  tool_call_count: number;
  fallback_used: boolean;
  path: "llm" | "deterministic_tool" | "deterministic_fallback" | "policy" | null;
  validations: number;
  errors: string[];
  estimated_cost_usd?: number | null;
  formula_versions: Record<string, string>;
  artifact_id: string | null;
  artifact_status: "none" | "generated" | "delivered" | "failed";
  model: string | null;
  intent: string | null;
  capability: string | null;
  tool_scope: string[];
  model_attempts: Array<{ model: string; ok: boolean; error?: string | null }>;
  /** Eficiência (`nino_efficiency.v1`). */
  llm_calls: number;
  tool_result_full_chars: number;
  tool_result_llm_chars: number;
  route_reason: string | null;
  model_tier: string | null;
};

export function createMetrics(channel: string): TurnMetrics {
  return {
    channel,
    stages: {},
    tools: [],
    tokens_in: 0, tokens_out: 0,
    tool_call_count: 0,
    fallback_used: false,
    path: null,
    validations: 0,
    errors: [],
    estimated_cost_usd: null,
    formula_versions: {},
    artifact_id: null,
    artifact_status: "none",
    model: null,
    intent: null,
    capability: null,
    tool_scope: [],
    model_attempts: [],
    llm_calls: 0,
    tool_result_full_chars: 0,
    tool_result_llm_chars: 0,
    route_reason: null,
    model_tier: null,
  };
}

export function recordFormulaVersion(m: TurnMetrics, tool: string, version: string): void {
  if (tool && version) m.formula_versions[tool] = version;
}

export function recordArtifact(m: TurnMetrics, status: TurnMetrics["artifact_status"], id?: string | null): void {
  m.artifact_status = status;
  if (id) m.artifact_id = id;
}

export async function timeStage<T>(
  m: TurnMetrics, stage: StageName, fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try { return await fn(); }
  finally { m.stages[stage] = (m.stages[stage] ?? 0) + (Date.now() - t0); }
}

/** Very rough token→USD estimate. Only used when we can't join ai_model_prices.
 *  Numbers are order-of-magnitude only; keep them permissive. */
export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const m = String(model ?? "");
  // Ordem importa: variantes mais específicas primeiro.
  const [per1K_in, per1K_out] =
      /flash-lite|gpt-5(\.\d)?-nano|gpt-5\.4-nano/.test(m) ? [0.0001, 0.0004]
    : /gemini-3(\.\d)?-flash|gemini-2\.5-flash/.test(m) ? [0.0003, 0.0012]
    : /gpt-5(\.\d)?-mini|gpt-5\.4-mini/.test(m) ? [0.0004, 0.0016]
    : /pro-preview|gemini-2\.5-pro/.test(m) ? [0.0013, 0.0100]
    : /gpt-5\.6|gpt-5\.5|gpt-5\.4|gpt-5\b/.test(m) ? [0.0013, 0.0100]
    : [0.0010, 0.0040];
  return +(tokensIn / 1000 * per1K_in + tokensOut / 1000 * per1K_out).toFixed(6);
}

export function summarize(m: TurnMetrics): Record<string, unknown> {
  return {
    channel: m.channel,
    total_ms: m.stages.total ?? 0,
    stages_ms: m.stages,
    tools: m.tools,
    tool_call_count: m.tool_call_count,
    tokens_in: m.tokens_in,
    tokens_out: m.tokens_out,
    fallback_used: m.fallback_used,
    path: m.path,
    validations: m.validations,
    errors: m.errors,
    estimated_cost_usd: m.estimated_cost_usd,
    capability: m.capability,
    tool_scope: m.tool_scope,
    model_attempts: m.model_attempts,
    llm_calls: m.llm_calls,
    tool_result_full_chars: m.tool_result_full_chars,
    tool_result_llm_chars: m.tool_result_llm_chars,
    compression_ratio: m.tool_result_full_chars > 0
      ? Math.round((m.tool_result_llm_chars / m.tool_result_full_chars) * 1000) / 1000
      : null,
    route_reason: m.route_reason,
    model_tier: m.model_tier,
  };
}
