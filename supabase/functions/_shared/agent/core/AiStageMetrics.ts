// AiStageMetrics (`nino_semantic_ir.v3`)
//
// Causa-raiz que este módulo fecha: o compilador somava tokens em `metrics`, mas
// o planner SOBRESCREVIA `tokens_in/tokens_out/llm_calls`. Toda chamada do
// compilador semântico desaparecia da telemetria. Agora cada estágio de IA se
// registra e os agregados são SOMA dos estágios — nunca atribuição direta.
export type AiStageName = "semantic_compiler" | "investigation_replan" | "response_generator" | "planner";

export type AiStageUsage = {
  stage: AiStageName;
  model: string | null;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  ok: boolean;
};

type MetricsLike = {
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  ai_stages?: AiStageUsage[];
};

export function recordAiStage<T extends MetricsLike>(metrics: T, usage: AiStageUsage): T {
  const stages = Array.isArray(metrics.ai_stages) ? metrics.ai_stages : [];
  stages.push({
    stage: usage.stage,
    model: usage.model ?? null,
    llm_calls: Math.max(0, Number(usage.llm_calls ?? 0)),
    tokens_in: Math.max(0, Number(usage.tokens_in ?? 0)),
    tokens_out: Math.max(0, Number(usage.tokens_out ?? 0)),
    latency_ms: Math.max(0, Number(usage.latency_ms ?? 0)),
    ok: usage.ok !== false,
  });
  metrics.ai_stages = stages;
  return applyAiStageTotals(metrics);
}

/** Agregados de IA do turno = soma dos estágios. Idempotente. */
export function applyAiStageTotals<T extends MetricsLike>(metrics: T): T {
  const stages = Array.isArray(metrics.ai_stages) ? metrics.ai_stages : [];
  metrics.llm_calls = stages.reduce((sum, s) => sum + s.llm_calls, 0);
  metrics.tokens_in = stages.reduce((sum, s) => sum + s.tokens_in, 0);
  metrics.tokens_out = stages.reduce((sum, s) => sum + s.tokens_out, 0);
  return metrics;
}

export function aiLatencyMs(metrics: MetricsLike): number {
  return (metrics.ai_stages ?? []).reduce((sum, s) => sum + s.latency_ms, 0);
}
