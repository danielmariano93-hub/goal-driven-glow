// AdaptiveExecutionRouter (`nino_adaptive.v1`)
//
// Uma escada progressiva, não cinco pipelines. O roteador escolhe o tier MAIS
// BAIXO plausível e só escala quando um gate real exige. Nenhuma chamada de
// modelo acontece aqui: a decisão é determinística sobre os sinais do turno.
//
// Preserva a arquitetura canônica: o tier apenas define orçamento (contexto,
// modelo, chamadas, timeout). Quem calcula número continua sendo o motor
// canônico; quem entende continua sendo o Semantic IR quando o tier o exige.
import type { TurnSignals } from "./TurnComplexityClassifier.ts";
import { budgetFor, type TurnRoute } from "./TurnBudget.ts";

export type ExecutionTier = 0 | 1 | 2 | 3 | 4;

export type ModelTier = "none" | "small" | "standard" | "reasoning";

/** Gates que podem forçar escalada. Nenhum outro motivo é aceito. */
export type EscalationGate =
  | "route_confidence"
  | "topic_confidence"
  | "evidence_confidence"
  | "write_safety"
  | "response_grounding"
  | "completeness";

export type ExecutionPlan = {
  tier: ExecutionTier;
  route: TurnRoute;
  model_tier: ModelTier;
  selection_reason: string;
  max_llm_calls: number;
  max_prompt_chars: number;
  timeout_budget_ms: number;
  /** Semantic IR só entra a partir do T3, ou no T2 quando há ambiguidade. */
  use_semantic_ir: boolean;
  /** Permite executar ferramentas independentes em paralelo. */
  allow_parallel_tools: boolean;
  escalations: Array<{ from: ExecutionTier; to: ExecutionTier; gate: EscalationGate }>;
};

/** Metas de latência de BACKEND por tier (ms). Não incluem transporte externo. */
export const TIER_LATENCY_TARGETS: Readonly<Record<ExecutionTier, { p50: number; p95: number }>> = {
  0: { p50: 500, p95: 1_500 },
  1: { p50: 1_500, p95: 3_000 },
  2: { p50: 2_500, p95: 5_000 },
  3: { p50: 4_000, p95: 7_000 },
  4: { p50: 6_000, p95: 10_000 },
};

const ROUTE_BY_TIER: Readonly<Record<ExecutionTier, TurnRoute>> = {
  0: "confirmation",
  1: "structured_entry",
  2: "financial_analysis",
  3: "financial_analysis",
  4: "complex",
};

const MODEL_BY_TIER: Readonly<Record<ExecutionTier, ModelTier>> = {
  0: "none", 1: "none", 2: "small", 3: "standard", 4: "reasoning",
};

const TIMEOUT_BY_TIER: Readonly<Record<ExecutionTier, number>> = {
  0: 3_000, 1: 6_000, 2: 12_000, 3: 20_000, 4: 30_000,
};

export type RouteInput = {
  signals: TurnSignals;
  /** Estado puro já resolvido (confirmar/cancelar pendência fresca). */
  state_transition?: boolean;
  /** Comprovante bancário reconhecido e inequívoco. */
  structured_event?: boolean;
  /** Escrita simples em linguagem natural ("gastei 30 no mercado"). */
  simple_write?: boolean;
};

export function selectTier(input: RouteInput): { tier: ExecutionTier; reason: string } {
  const s = input.signals;
  if (input.state_transition) return { tier: 0, reason: "state_transition" };
  if (input.structured_event) return { tier: 1, reason: "structured_event" };
  if (input.simple_write) return { tier: 1, reason: "simple_write_high_confidence" };

  if (s.complexity_score >= 0.6 || s.expected_tool_count >= 3 || s.financial_reasoning_score >= 0.6) {
    return { tier: 4, reason: "multi_domain_reasoning" };
  }
  if (s.context_dependency_score >= 0.5 || s.conversation_resume_probability >= 0.6) {
    return { tier: 3, reason: "context_dependent" };
  }
  if (s.financial_reasoning_score >= 0.3 || s.expected_tool_count >= 2) {
    return { tier: 3, reason: "comparison_or_two_domains" };
  }
  if (s.evidence_availability >= 0.6 && s.ambiguity_score < 0.3) {
    return { tier: 2, reason: "simple_factual_read" };
  }
  return { tier: 3, reason: "insufficient_determination" };
}

export function planExecution(input: RouteInput): ExecutionPlan {
  const { tier, reason } = selectTier(input);
  return buildPlan(tier, reason, input.signals);
}

function buildPlan(tier: ExecutionTier, reason: string, s: TurnSignals): ExecutionPlan {
  const route = ROUTE_BY_TIER[tier];
  const budget = budgetFor(route);
  // T2 é leitura factual: um motor canônico e resposta curta. Nunca herda o
  // orçamento largo da análise composta.
  const max_llm_calls = tier === 0 || tier === 1 ? 0 : tier === 2 ? 1 : budget.max_llm_calls;
  const max_prompt_chars = tier === 2 ? 10_000 : budget.max_prompt_chars;
  return {
    tier,
    route,
    model_tier: MODEL_BY_TIER[tier],
    selection_reason: reason,
    max_llm_calls,
    max_prompt_chars,
    timeout_budget_ms: TIMEOUT_BY_TIER[tier],
    use_semantic_ir: tier >= 3 || (tier === 2 && s.ambiguity_score >= 0.3),
    allow_parallel_tools: tier >= 3 && s.expected_tool_count >= 2,
    escalations: [],
  };
}

/**
 * Escalada progressiva: só sobe um tier quando um gate declarado exige. Nunca
 * desce (a resposta já em curso não pode perder qualidade) e nunca passa do T4.
 */
export function escalate(plan: ExecutionPlan, gate: EscalationGate, signals: TurnSignals): ExecutionPlan {
  if (plan.tier >= 4) {
    return { ...plan, escalations: [...plan.escalations, { from: 4, to: 4, gate }] };
  }
  const to = (plan.tier + 1) as ExecutionTier;
  const next = buildPlan(to, `escalated:${gate}`, signals);
  return { ...next, escalations: [...plan.escalations, { from: plan.tier, to, gate }] };
}

/** Early exit: já sabemos intenção, entidade, período, motor e evidência. */
export function canEarlyExit(s: TurnSignals): boolean {
  return s.evidence_availability >= 0.8 && s.ambiguity_score <= 0.2 && s.context_dependency_score <= 0.2;
}

export function tierTargets(tier: ExecutionTier): { p50: number; p95: number } {
  return TIER_LATENCY_TARGETS[tier];
}
