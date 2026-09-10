// TurnBudget (`nino_turn_budget.v1`) — inteligência proporcional ao problema.
//
// O run real do incidente mostrou 25.815 chars de system policy e 2 chamadas de
// modelo para processar a palavra "Salvar". Confirmar uma escrita já
// estruturada não precisa de diagnóstico, snapshot, assessor nem LLM.

export type TurnRoute =
  | "confirmation"        // confirmar/cancelar pendência (estado puro)
  | "structured_entry"    // comprovante bancário reconhecido
  | "simple_write"        // lançamento simples em linguagem natural
  | "financial_analysis"  // leitura/análise financeira
  | "complex";            // multi-query / investigação

export type TurnBudget = {
  route: TurnRoute;
  /** Máximo de chamadas de modelo permitidas nesta rota. */
  max_llm_calls: number;
  /** Máximo de chars de prompt de sistema (0 = nenhum prompt). */
  max_prompt_chars: number;
  load_diagnosis: boolean;
  load_financial_snapshot: boolean;
  load_advisor_context: boolean;
  load_period_comparison: boolean;
};

const BUDGETS: Readonly<Record<TurnRoute, TurnBudget>> = {
  confirmation: {
    route: "confirmation", max_llm_calls: 0, max_prompt_chars: 0,
    load_diagnosis: false, load_financial_snapshot: false,
    load_advisor_context: false, load_period_comparison: false,
  },
  structured_entry: {
    route: "structured_entry", max_llm_calls: 0, max_prompt_chars: 0,
    load_diagnosis: false, load_financial_snapshot: false,
    load_advisor_context: false, load_period_comparison: false,
  },
  simple_write: {
    route: "simple_write", max_llm_calls: 1, max_prompt_chars: 8_000,
    load_diagnosis: false, load_financial_snapshot: false,
    load_advisor_context: false, load_period_comparison: false,
  },
  financial_analysis: {
    route: "financial_analysis", max_llm_calls: 2, max_prompt_chars: 26_000,
    load_diagnosis: true, load_financial_snapshot: true,
    load_advisor_context: true, load_period_comparison: true,
  },
  complex: {
    route: "complex", max_llm_calls: 4, max_prompt_chars: 32_000,
    load_diagnosis: true, load_financial_snapshot: true,
    load_advisor_context: true, load_period_comparison: true,
  },
};

export function budgetFor(route: TurnRoute): TurnBudget {
  return BUDGETS[route];
}

/** Rotas que NUNCA carregam contexto pesado nem chamam modelo. */
export const ZERO_LLM_ROUTES: ReadonlyArray<TurnRoute> = ["confirmation", "structured_entry"];

export function isZeroLlmRoute(route: TurnRoute): boolean {
  return ZERO_LLM_ROUTES.includes(route);
}

/** Metas de latência de BACKEND (sem transporte do WhatsApp), em ms. */
export const BACKEND_LATENCY_TARGETS: Readonly<Record<string, { p50: number; p95: number }>> = {
  confirmation_fast_path: { p50: 1_000, p95: 2_000 },
  structured_entry_fast_path: { p50: 2_000, p95: 3_000 },
};

/** Auditoria dos blocos que compõem o prompt, para achar o excesso. */
export function auditPromptBlocks(blocks: Record<string, string | null | undefined>): {
  total_chars: number;
  blocks: Array<{ name: string; chars: number; share: number }>;
} {
  const entries = Object.entries(blocks).map(([name, value]) => ({
    name, chars: String(value ?? "").length,
  }));
  const total = entries.reduce((acc, e) => acc + e.chars, 0);
  return {
    total_chars: total,
    blocks: entries
      .map((e) => ({ ...e, share: total > 0 ? Math.round((e.chars / total) * 1000) / 1000 : 0 }))
      .sort((a, b) => b.chars - a.chars),
  };
}
