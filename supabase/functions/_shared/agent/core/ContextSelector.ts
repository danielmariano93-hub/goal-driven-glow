// ContextSelector (`nino_adaptive.v1`)
//
// SELECIONAR ANTES DE CARREGAR. Antes, o turno montava todo o contexto e depois
// tentava truncar (`ContextBudget`), o que gerava prompts de 20k+ chars até para
// a palavra "Salvar". Aqui a decisão vem primeiro: quais camadas têm motivo.
//
// `ContextBudget` continua existindo como rede de segurança — não como
// estratégia.
import type { ExecutionTier } from "./AdaptiveExecutionRouter.ts";

export type ContextBlock =
  | "financial_truth"
  | "conversation_topics"
  | "episodic_memory"
  | "semantic_memory"
  | "advisor_context"
  | "diagnosis"
  | "behavior_context"
  | "financial_snapshot"
  | "proactive_context"
  | "documents"
  | "history";

export const ALL_CONTEXT_BLOCKS: readonly ContextBlock[] = [
  "financial_truth", "conversation_topics", "episodic_memory", "semantic_memory",
  "advisor_context", "diagnosis", "behavior_context", "financial_snapshot",
  "proactive_context", "documents", "history",
];

export type ContextSelection = {
  loaded: ContextBlock[];
  skipped: ContextBlock[];
  history_turns: number;
  reason: string;
};

const BY_TIER: Readonly<Record<ExecutionTier, ContextBlock[]>> = {
  // Transição de estado: o rascunho pendente é todo o contexto necessário.
  0: [],
  // Estruturado: precisa de contas/estrutura, nada de diagnóstico.
  1: ["financial_truth"],
  // Leitura factual: um motor canônico + histórico curto para o tom.
  2: ["financial_truth", "history", "conversation_topics"],
  // Análise contextual: retoma assunto e período.
  3: ["financial_truth", "history", "conversation_topics", "episodic_memory", "financial_snapshot"],
  // Raciocínio composto: o caminho completo atual.
  4: [
    "financial_truth", "history", "conversation_topics", "episodic_memory",
    "semantic_memory", "advisor_context", "diagnosis", "behavior_context",
    "financial_snapshot", "proactive_context",
  ],
};

const HISTORY_BY_TIER: Readonly<Record<ExecutionTier, number>> = {
  0: 0, 1: 0, 2: 4, 3: 8, 4: 12,
};

export function selectContext(args: {
  tier: ExecutionTier;
  /** Turno depende de documento citado/anexado. */
  needs_documents?: boolean;
  /** Resolução de assunto pediu tópicos mesmo em tier baixo. */
  needs_topics?: boolean;
}): ContextSelection {
  const base = new Set<ContextBlock>(BY_TIER[args.tier]);
  if (args.needs_documents) base.add("documents");
  if (args.needs_topics) base.add("conversation_topics");
  const loaded = ALL_CONTEXT_BLOCKS.filter((b) => base.has(b));
  const skipped = ALL_CONTEXT_BLOCKS.filter((b) => !base.has(b));
  return {
    loaded,
    skipped,
    history_turns: HISTORY_BY_TIER[args.tier],
    reason: `tier_${args.tier}`,
  };
}

/** Camadas cacheáveis: SÓ configuração e estrutura. Nunca verdade financeira. */
export const CACHEABLE_LAYERS = [
  "feature_flags", "active_prompt", "model_routes", "communication_policy", "capability_registry",
] as const;

export const NEVER_CACHEABLE = [
  "saldo", "fatura", "divida", "metas", "pagamentos", "lancamentos",
] as const;

export function isCacheable(layer: string): boolean {
  return (CACHEABLE_LAYERS as readonly string[]).includes(layer);
}
