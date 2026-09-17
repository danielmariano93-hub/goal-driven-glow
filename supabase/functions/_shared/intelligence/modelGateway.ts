import type { ModelRoute, ModelTask, SemanticQuery } from "./contracts.ts";

/**
 * Tiers de modelo (`nino_efficiency.v1`).
 *
 * Antes, as 5 rotas de `ai_model_routes` apontavam para o MESMO modelo
 * (`google/gemini-2.5-flash`, geração anterior) com fallback único: não havia
 * tier barato para classificação nem tier de raciocínio para consultoria. O
 * tier 0 (determinístico, zero token) é decidido antes daqui, no planner.
 */
export type ModelTier = "tier1_light" | "tier2_analysis" | "tier3_reasoning" | "vision";

// Runtime-owned model tiers. The configured provider is the authority; stale
// database model ids from the old gateway must never silently select a provider.
export const MODEL_TIERS: Readonly<Record<ModelTier, { primary: string; fallback: string }>> = {
  // Classificação ambígua e entendimento curto.
  tier1_light: { primary: "openai/gpt-oss-20b", fallback: "openai/gpt-oss-120b" },
  // Análise financeira e perguntas compostas.
  tier2_analysis: { primary: "openai/gpt-oss-120b", fallback: "openai/gpt-oss-20b" },
  // Raciocínio complexo.
  tier3_reasoning: { primary: "openai/gpt-oss-120b", fallback: "openai/gpt-oss-20b" },
  // Documentos difíceis (imagem/escaneado).
  vision: { primary: "qwen/qwen3.8-27b", fallback: "qwen/qwen3.8-27b" },
};

export function tierForTask(task: ModelTask): ModelTier {
  if (task === "vision") return "vision";
  if (task === "complex_reasoning") return "tier3_reasoning";
  if (task === "fast_operation" || task === "semantic_classification" || task === "fallback") {
    return "tier1_light";
  }
  // `document_text` e `financial_analysis` compartilham o tier de análise.
  return "tier2_analysis";
}

/** Passos máximos por tier: loop curto é o que corta custo e latência. */
export function maxStepsForTier(tier: ModelTier): number {
  if (tier === "tier1_light") return 2;
  if (tier === "tier3_reasoning") return 3;
  if (tier === "vision") return 3;
  return 3;
}

export function latencyForTier(tier: ModelTier): number {
  if (tier === "tier1_light") return 12_000;
  if (tier === "tier3_reasoning") return 30_000;
  if (tier === "vision") return 30_000;
  return 20_000;
}


function env(name: string): string | null {
  try {
    const value = (globalThis as any)?.Deno?.env?.get?.(name);
    return value ? String(value) : null;
  } catch {
    return null;
  }
}

/**
 * Classificação da tarefa por COMPLEXIDADE real, não por palavra-chave solta.
 *
 * "análise" sozinha não paga tier 3: raciocínio caro exige pedido explícito de
 * plano/cenário/estratégia OU pergunta composta longa com causalidade. Perguntas
 * factuais e de registro ficam no tier leve.
 */
export function classifyModelTask(text: string, semantic: SemanticQuery | null): ModelTask {
  if (semantic?.intent === "weekday_pattern") return "semantic_classification";
  const raw = String(text ?? "");
  const t = raw.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

  if (/\b(foto|imagem|print|nota fiscal|comprovante|pdf|boleto)\b/.test(t)) return "vision";

  // Registro/leitura curta e direta: tier leve.
  if (/\b(registre|registra|anota|gastei|recebi|transferi|paguei|saldo|ultimos|ultimas)\b/.test(t)) {
    return "fast_operation";
  }

  // Reasoning real: planejamento, cenário, estratégia, simulação de trade-off,
  // ou causalidade encadeada em pergunta longa.
  const asksPlan = /\b(planej|estrateg|cenario|simul|trade-?off|como (eu )?(faco|posso|consigo) para|monta(r)? um plano|quanto preciso guardar)\b/.test(t);
  const asksCausality = /\b(por que|porque|o que (mudou|explica)|qual a causa|o que esta (me )?atrapalhando)\b/.test(t);
  const composed = (raw.match(/[?]/g)?.length ?? 0) > 1 || /\b e (tambem|ainda)\b/.test(t);
  const long = raw.trim().length > 160;
  if (asksPlan && (long || composed)) return "complex_reasoning";
  if (asksCausality && composed) return "complex_reasoning";

  return "financial_analysis";
}

export function selectModelRoute(task: ModelTask, configuredModel: string, configuredMaxSteps = 6): ModelRoute {
  const tier = tierForTask(task);
  const defaults = MODEL_TIERS[tier];
  const envPrimary = tier === "vision"
    ? (env("NINO_AI_VISION_MODEL") ?? env("AI_MODEL_VISION"))
    : tier === "tier1_light"
    ? (env("NINO_AI_FAST_MODEL") ?? env("AI_MODEL_FAST"))
    : (env("NINO_AI_MODEL") ?? env("AI_MODEL_REASONING"));
  const primary = envPrimary ?? defaults.primary;
  // Model fallback protects against a model-specific outage/rate-limit. Cross-
  // provider failover is handled separately by provider configuration.
  const configuredFallback = env("NINO_AI_FALLBACK_MODEL") ?? env("AI_MODEL_FALLBACK") ?? defaults.fallback;
  const fallback = configuredFallback && configuredFallback !== primary ? configuredFallback : null;
  return {
    task,
    primary,
    fallback,
    max_latency_ms: latencyForTier(tier),
    max_steps: Math.min(maxStepsForTier(tier), Math.max(1, configuredMaxSteps || maxStepsForTier(tier))),
    reason: `tier:${tier}`,
  };
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
    const envPrimary = task === "vision"
      ? (env("NINO_AI_VISION_MODEL") ?? env("AI_MODEL_VISION"))
      : task === "fast_operation" || task === "semantic_classification"
      ? (env("NINO_AI_FAST_MODEL") ?? env("AI_MODEL_FAST"))
      : (env("NINO_AI_MODEL") ?? env("AI_MODEL_REASONING"));
    const primary = envPrimary ?? String(data.primary_model || fallback.primary);
    const configuredFallback = env("NINO_AI_FALLBACK_MODEL") ?? env("AI_MODEL_FALLBACK")
      ?? (data.fallback_model ? String(data.fallback_model) : fallback.fallback);
    const independentFallback = configuredFallback && configuredFallback !== primary
      ? configuredFallback
      : fallback.fallback !== primary ? fallback.fallback : null;
    return {
      ...fallback,
      primary,
      fallback: independentFallback,
      max_latency_ms: Number(data.max_latency_ms || fallback.max_latency_ms),
      // A rota do banco pode reduzir os passos, nunca inflá-los: `max_steps` 8
      // era o que fazia o loop reenviar contexto 8 vezes.
      max_steps: Math.min(fallback.max_steps, Number(data.max_steps || fallback.max_steps)),
      reason: `database_route:${task}`,
    };
  } catch {
    return fallback;
  }
}
