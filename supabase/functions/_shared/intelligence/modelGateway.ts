import type { ModelRoute, ModelTask, SemanticQuery } from "./contracts.ts";

function env(name: string): string | null {
  try {
    const value = (globalThis as any)?.Deno?.env?.get?.(name);
    return value ? String(value) : null;
  } catch {
    return null;
  }
}

export function classifyModelTask(text: string, semantic: SemanticQuery | null): ModelTask {
  if (semantic?.intent === "weekday_pattern") return "semantic_classification";
  const t = String(text ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (/\b(analise completa|cenario|simul|estrateg|por que|explique|planej)\b/.test(t)) return "complex_reasoning";
  if (/\b(foto|imagem|print|nota fiscal|extrato|pdf|boleto)\b/.test(t)) return "vision";
  if (/\b(registre|gastei|recebi|transferi|saldo|ultimos)\b/.test(t)) return "fast_operation";
  return "financial_analysis";
}

export function selectModelRoute(task: ModelTask, configuredModel: string, configuredMaxSteps = 6): ModelRoute {
  const fast = env("AI_MODEL_FAST") ?? configuredModel;
  const reasoning = env("AI_MODEL_REASONING") ?? configuredModel;
  const vision = env("AI_MODEL_VISION") ?? reasoning;
  const fallback = env("AI_MODEL_FALLBACK") ?? configuredModel;

  if (task === "vision") {
    return { task, primary: vision, fallback, max_latency_ms: 30_000, max_steps: Math.max(6, configuredMaxSteps), reason: "multimodal_input" };
  }
  if (task === "complex_reasoning") {
    return { task, primary: reasoning, fallback, max_latency_ms: 30_000, max_steps: Math.max(8, configuredMaxSteps), reason: "complex_financial_reasoning" };
  }
  if (task === "fast_operation" || task === "semantic_classification") {
    return { task, primary: fast, fallback, max_latency_ms: 15_000, max_steps: Math.min(6, configuredMaxSteps), reason: "low_latency_deterministic_task" };
  }
  return { task, primary: reasoning, fallback, max_latency_ms: 25_000, max_steps: configuredMaxSteps, reason: "financial_analysis" };
}


// Database routes are optional. Environment overrides still win, which lets
// operations roll back a provider without redeploying the application.
// deno-lint-ignore no-explicit-any
export async function loadModelRoute(
  sb: any,
  task: ModelTask,
  configuredModel: string,
  configuredMaxSteps = 6,
): Promise<ModelRoute> {
  const fallback = selectModelRoute(task, configuredModel, configuredMaxSteps);
  try {
    const { data } = await sb.from("ai_model_routes")
      .select("primary_model,fallback_model,max_latency_ms,max_steps,active")
      .eq("task", task).eq("active", true).maybeSingle();
    if (!data) return fallback;
    const envPrimary = task === "vision" ? env("AI_MODEL_VISION")
      : task === "fast_operation" || task === "semantic_classification" ? env("AI_MODEL_FAST")
      : env("AI_MODEL_REASONING");
    return {
      ...fallback,
      primary: envPrimary ?? String(data.primary_model || fallback.primary),
      fallback: env("AI_MODEL_FALLBACK") ?? (data.fallback_model ? String(data.fallback_model) : fallback.fallback),
      max_latency_ms: Number(data.max_latency_ms || fallback.max_latency_ms),
      max_steps: Number(data.max_steps || fallback.max_steps),
      reason: `database_route:${task}`,
    };
  } catch {
    return fallback;
  }
}
