// ToolBudget (`nino_efficiency.v1`) — orçamento de caracteres do resultado de
// ferramenta que entra no prompt do modelo.
//
// Causa raiz que este módulo fecha: `llm.ts` serializava o resultado INTEGRAL da
// tool no histórico do loop. Medições reais de `agent_tool_calls` neste projeto:
// assess_financial_performance 45.150 chars, analyze_merchants 25.298,
// get_weekday_spending_pattern 10.267, get_financial_snapshot 8.943. Cada passo
// do loop reenvia tudo — era o maior consumidor de tokens de entrada.
//
// Regra: o resultado completo continua sendo persistido em `agent_tool_calls`
// (auditoria e artifacts). Só a evidência comprimida vai para o modelo.

/** Orçamento padrão por resultado de ferramenta enviado ao modelo. */
export const LLM_TOOL_RESULT_MAX_CHARS = 2_000;

/**
 * Exceções declaradas. Toda entrada aqui é uma decisão explícita, com motivo,
 * e é coberta pelo teste de regressão de orçamento — nunca um acidente.
 */
export const TOOL_RESULT_BUDGET_OVERRIDES: Readonly<Record<string, number>> = {
  // Séries usadas para desenhar gráfico precisam de mais pontos.
  spending_timeseries_daily: 3_000,
  spending_average_daily_trend: 3_000,
  // Padrão semanal: 7 dias × (total, média, mediana, amostra).
  get_weekday_spending_pattern: 2_600,
  // Rascunhos e confirmações são pequenos por natureza, mas o texto do recibo
  // precisa chegar íntegro para o modelo não reescrever valores.
  create_transaction_draft: 2_400,
  confirm_pending_action: 2_400,
};

export function budgetForTool(toolName: string): number {
  return TOOL_RESULT_BUDGET_OVERRIDES[toolName] ?? LLM_TOOL_RESULT_MAX_CHARS;
}

/** Lista auditável de todas as exceções (usada pelo teste e pela documentação). */
export function declaredOverrides(): Array<{ tool: string; max_chars: number }> {
  return Object.entries(TOOL_RESULT_BUDGET_OVERRIDES)
    .map(([tool, max_chars]) => ({ tool, max_chars }))
    .sort((a, b) => b.max_chars - a.max_chars);
}
