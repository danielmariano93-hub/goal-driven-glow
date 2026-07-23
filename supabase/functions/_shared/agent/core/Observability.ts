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
  path: "llm" | "deterministic_fallback" | "policy" | null;
  validations: number;
  errors: string[];
  estimated_cost_usd?: number | null;
  formula_versions: Record<string, string>;
  artifact_id: string | null;
  artifact_status: "none" | "generated" | "delivered" | "failed";
  model: string | null;
  intent: string | null;
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
  const per1K_in = model.includes("gpt-5") ? 0.005
    : model.includes("gemini") ? 0.0005
    : 0.001;
  const per1K_out = per1K_in * 3;
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
  };
}
