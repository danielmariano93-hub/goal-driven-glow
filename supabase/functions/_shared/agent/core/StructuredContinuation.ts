// StructuredContinuation (`nino_continuation.v2`)
//
// A confirmação de uma oferta que o próprio Nino acabou de fazer é um EVENTO
// ESTRUTURADO, não um novo problema de compreensão. Quando a operação e o foco
// necessários já estão na memória, compilamos diretamente um Turn Contract e
// não dependemos do provedor de IA para entender "sim", "faz isso" ou "quero".

import type { ConversationMemory } from "./ConversationMemory.ts";
import type { PendingConversationAction } from "./ContinuationContract.ts";
import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "./ConversationTurnContract.ts";

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function comparisonContract(
  action: PendingConversationAction,
  memory: ConversationMemory | null | undefined,
): CanonicalConversationTurnContract | null {
  const category = clean(memory?.active_category);
  const periodExpression = clean(memory?.active_period?.label) ?? "este mês";
  const metric = action.requested_operation.metric === "income" ? "income_amount" : "expense_amount";
  const object = category ? `meu gasto em ${category}` : metric === "income_amount" ? "minhas receitas" : "meus gastos";
  const canonical = `Compare ${object} em ${periodExpression} com o período anterior equivalente e mostre a variação.`;

  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "answer",
    mode: "read",
    domain: "financial_read",
    canonical_request: canonical,
    inherit_focus: true,
    focus: {
      category,
      merchant: null,
      goal: null,
      period_expression: periodExpression,
      period_expressions: [periodExpression],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "resolved",
      entity: category ? "resolved" : "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "analyze",
      queries: [{
        metric,
        operation: "compare",
        group_by: [],
        filters: category ? [{ field: "category", value: category }] : [],
        limit: null,
        comparison_direction: "any",
        comparison_baseline: "period",
        comparison_baseline_window: null,
        comparison_baseline_expression: null,
        comparison_target_expression: null,
      }],
    },
    advisory_kind: null,
  });
}

/**
 * Retorna contrato somente quando o estado já determina a operação. Qualquer
 * ação não coberta continua indo para o Conversation Brain — fail closed, sem
 * ampliar escopo por heurística.
 */
export function structuredContinuationContract(
  action: PendingConversationAction | null | undefined,
  memory: ConversationMemory | null | undefined,
): CanonicalConversationTurnContract | null {
  if (!action) return null;
  switch (action.action_type) {
    case "financial_comparison":
      return comparisonContract(action, memory);
    default:
      return null;
  }
}
