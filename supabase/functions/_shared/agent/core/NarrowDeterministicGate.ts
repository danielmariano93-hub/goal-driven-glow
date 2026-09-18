// NarrowDeterministicGate (`nino_fast_contract.v2`)
//
// Latency/safety fast path for a deliberately tiny set of exact reads plus one
// ambiguity guard that prevents the engine from inventing a comparison target.
// Anything outside these exact shapes goes to the Conversation Brain.

import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "./ConversationTurnContract.ts";

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXACT_READS = new Map<string, string>([
  ["qual meu saldo", "Qual é meu saldo atual?"],
  ["qual e meu saldo", "Qual é meu saldo atual?"],
  ["quanto tenho de saldo", "Qual é meu saldo atual?"],
  ["qual meu patrimonio", "Qual é meu patrimônio líquido atual?"],
  ["qual e meu patrimonio", "Qual é meu patrimônio líquido atual?"],
  ["quanto tenho de patrimonio", "Qual é meu patrimônio líquido atual?"],
]);

const MONTH_TOKEN = "janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
const EXPLICIT_TARGET_RX = new RegExp(
  `\\b(?:em|de|no|na)\\s+(?:${MONTH_TOKEN}|este mes|esse mes|neste mes|mes atual|mes passado|mes anterior)\\b|\\b(?:hoje|ontem)\\b`,
);
const MONTH_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
};
const HISTORICAL_MEAN_RX = /\bmedia\b.*\bultimos?\s+(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+meses?\b/;

function ambiguousCategoryAverageComparison(value: string): number | null {
  const hasCategory = /\bcategorias?\b/.test(value);
  const hasDirection = /\b(?:acima|abaixo|aument|diminu|subiu|caiu)\w*\b/.test(value);
  const match = HISTORICAL_MEAN_RX.exec(value);
  const raw = match?.[1] ?? "";
  const months = MONTH_WORDS[raw] ?? Number(raw);
  const validWindow = Number.isInteger(months) && months >= 2 && months <= 24;
  return hasCategory && hasDirection && validWindow && !EXPLICIT_TARGET_RX.test(value) ? months : null;
}

function ambiguityContract(text: string, months: number): CanonicalConversationTurnContract | null {
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "clarify",
    domain: "conversation",
    canonical_request: text,
    inherit_focus: false,
    focus: {
      category: null,
      merchant: null,
      goal: null,
      period_expression: null,
      period_expressions: [],
    },
    action: null,
    direct_reply: null,
    clarification_question: `Você quer comparar este mês com a média dos ${months} meses anteriores ou comparar a média dos últimos ${months} meses com a dos ${months} meses anteriores?`,
    resolution: {
      intent: "ambiguous",
      reference: "not_applicable",
      time: "ambiguous",
      entity: "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  });
}

export function resolveNarrowDeterministicTurn(
  text: string,
): CanonicalConversationTurnContract | null {
  const normalized = norm(text);

  // "Quais categorias ficaram acima da média dos últimos N meses?" não diz
  // qual período está sendo julgado. Antes o runtime usava a mesma expressão
  // como alvo e baseline, criando uma comparação híbrida silenciosa.
  const ambiguousWindow = ambiguousCategoryAverageComparison(normalized);
  if (ambiguousWindow) return ambiguityContract(text, ambiguousWindow);

  const canonical = EXACT_READS.get(normalized);
  if (!canonical) return null;
  const metric = normalized.includes("patrimonio") ? "net_worth" : "balance";

  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "read",
    domain: "financial_read",
    canonical_request: canonical,
    inherit_focus: false,
    focus: {
      category: null,
      merchant: null,
      goal: null,
      period_expression: null,
      period_expressions: [],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "not_applicable",
      entity: "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "lookup",
      queries: [{
        metric,
        operation: "value",
        group_by: [],
        filters: [],
        limit: null,
      }],
    },
    advisory_kind: null,
  });
}
