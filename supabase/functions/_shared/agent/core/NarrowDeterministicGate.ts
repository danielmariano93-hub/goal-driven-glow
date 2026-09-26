// NarrowDeterministicGate (`nino_fast_contract.v2`)
//
// Latency/safety fast path for a deliberately tiny set of unequivocal reads plus
// one ambiguity guard that prevents the engine from inventing a comparison
// target. The gate emits the SAME canonical contract consumed by the ordinary
// runtime; it never answers directly or invents financial truth. Anything
// outside these closed shapes goes to the Conversation Brain.

import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "./ConversationTurnContract.ts";
import { detectCategory } from "./ConversationMemory.ts";

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXACT_READS = new Map<string, { canonical: string; metric: "balance" | "net_worth" | "goal_progress" }>([
  ["qual meu saldo", { canonical: "Qual é meu saldo atual?", metric: "balance" }],
  ["qual e meu saldo", { canonical: "Qual é meu saldo atual?", metric: "balance" }],
  ["quanto tenho de saldo", { canonical: "Qual é meu saldo atual?", metric: "balance" }],
  ["qual meu patrimonio", { canonical: "Qual é meu patrimônio líquido atual?", metric: "net_worth" }],
  ["qual e meu patrimonio", { canonical: "Qual é meu patrimônio líquido atual?", metric: "net_worth" }],
  ["quanto tenho de patrimonio", { canonical: "Qual é meu patrimônio líquido atual?", metric: "net_worth" }],
  // Stable, entity-free goal overview. This is a canonical capability, not a
  // phrase-specific answer: the read still executes get_goals_overview through
  // Financial IR and therefore uses current database truth.
  ["quais metas eu tenho", { canonical: "Quais metas eu tenho?", metric: "goal_progress" }],
  ["mostre minhas metas", { canonical: "Quais metas eu tenho?", metric: "goal_progress" }],
  ["me mostre minhas metas", { canonical: "Quais metas eu tenho?", metric: "goal_progress" }],
  ["como estao minhas metas", { canonical: "Como estão minhas metas?", metric: "goal_progress" }],
]);

const MONTH_TOKEN = "janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
const EXPLICIT_TARGET_RX = new RegExp(
  `\\b(?:em|de|no|na)\\s+(?:${MONTH_TOKEN}|este mes|esse mes|neste mes|mes atual|mes passado|mes anterior)\\b|\\b(?:hoje|ontem)\\b`,
);
const MONTH_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
};
const MONTH_COUNT_TOKEN = "\\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze";
const HISTORICAL_MEAN_RX = new RegExp(`\\bmedia\\b.*\\bultimos?\\s+(${MONTH_COUNT_TOKEN})\\s+meses?\\b`);
const MONTHLY_BREAKDOWN_RX = /\b(?:mes a mes|mes por mes|em cada mes|separe por mes|mostre por mes|traga por mes|liste por mes|por mes)\b/;
const MONTHLY_PERIOD_RX = new RegExp(
  `\\b(?:nos?\\s+)?(?:ultim[oa]s?)\\s+(${MONTH_COUNT_TOKEN})\\s+meses?(?:\\s+(?:fechados?|completos?))?\\b`,
);

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

const EXPLICIT_PERIOD_ANY_RX = new RegExp(
  `\\b(?:${MONTH_TOKEN}|este mes|esse mes|neste mes|mes atual|mes passado|mes anterior|hoje|ontem|anteontem|ultim[oa]s?\\s+\\d+\\s+(?:dias|semanas|meses)|por mes|ao mes)\\b`,
);

function normalizeEntity(value: string | null | undefined): string {
  return norm(String(value ?? ""));
}

/**
 * Fast contract for explicit factual monthly breakdowns such as:
 * - "quanto gastei em lazer mês a mês nos últimos 7 meses?"
 * - "quanto gastei com Lazer no Thales mês a mês nos últimos 7 meses?"
 *
 * This exists before the Conversation Brain on purpose: a clear read must not
 * become unavailable because the semantic model is rate-limited. It only emits
 * the semantic contract; dates and money are still resolved by the canonical
 * financial runtime.
 */
function directMonthlyExpenseLookup(text: string, normalized: string): CanonicalConversationTurnContract | null {
  if (!/^(?:nino\s+)?quanto(?:\s+que)?\s+(?:eu\s+)?gastei\b/.test(normalized)) return null;
  const marker = MONTHLY_BREAKDOWN_RX.exec(normalized);
  if (!marker) return null;

  const normalizedPrefix = normalized.slice(0, marker.index).trim();
  const normalizedScope = normalizedPrefix
    .replace(/^(?:nino\s+)?quanto(?:\s+que)?\s+(?:eu\s+)?gastei\s*/, "")
    .trim();
  if (!normalizedScope) return null;

  const raw = String(text ?? "").trim().replace(/[?!.]+$/g, "").trim();
  const rawMonthlyMarker = /\b(?:m[eê]s\s+a\s+m[eê]s|m[eê]s\s+por\s+m[eê]s|em\s+cada\s+m[eê]s|separe\s+por\s+m[eê]s|mostre\s+por\s+m[eê]s|traga\s+por\s+m[eê]s|liste\s+por\s+m[eê]s|por\s+m[eê]s)\b/i.exec(raw);
  if (!rawMonthlyMarker) return null;
  const rawPrefix = raw.slice(0, rawMonthlyMarker.index).trim();
  const rawScope = rawPrefix
    .replace(/^(?:nino\s*,?\s*)?quanto(?:\s+que)?\s+(?:eu\s+)?gastei\s*/i, "")
    .trim();

  const category = detectCategory(rawScope);
  let merchant: string | null = null;
  const merchantMatch = /\b(?:no|na|do|da)\s+(?:(?:estabelecimento|loja|comerciante)\s+)?(.+)$/i.exec(rawScope);
  if (merchantMatch?.[1]) {
    const candidate = merchantMatch[1].trim();
    if (!category || normalizeEntity(candidate) !== normalizeEntity(category)) merchant = candidate;
  }

  // Closed grammar: a named scope must resolve to category and/or merchant.
  // This prevents phrases with unrelated qualifiers from being partially read.
  if (!category && !merchant) return null;

  const periodMatch = MONTHLY_PERIOD_RX.exec(normalized);
  if (!periodMatch) return null;
  const periodExpression = periodMatch[0].replace(/^nos?\s+/, "").trim();
  const filters = [
    ...(category ? [{ field: "category" as const, value: category }] : []),
    ...(merchant ? [{ field: "merchant" as const, value: merchant }] : []),
  ];

  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "read",
    domain: "financial_read",
    canonical_request: raw,
    inherit_focus: false,
    focus: {
      category,
      merchant,
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
      entity: "resolved",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "analyze",
      queries: [{
        metric: "expense_amount",
        operation: "trend",
        group_by: ["month"],
        filters,
        limit: null,
      }],
    },
    advisory_kind: null,
  });
}

/**
 * Fast contract for the high-volume, unequivocal lookup shape
 * "quanto gastei [em categoria] [no estabelecimento X]". This bypasses the
 * probabilistic Brain only for a closed grammar; dates/comparisons and unknown
 * category wording continue through the full interpreter.
 */
function directExpenseLookup(text: string, normalized: string): CanonicalConversationTurnContract | null {
  if (!/^(?:nino\s+)?quanto(?:\s+que)?\s+(?:eu\s+)?gastei\b/.test(normalized)) return null;
  if (EXPLICIT_PERIOD_ANY_RX.test(normalized)) return null;

  const raw = String(text ?? "").trim().replace(/[?!.]+$/g, "").trim();
  const merchantMatch = /\b(?:(?:no|na|do|da)\s+)?(?:estabelecimento|loja|comerciante)\s+(.+)$/i.exec(raw);
  const merchant = merchantMatch?.[1]?.trim() || null;
  const categoryText = merchantMatch ? raw.slice(0, merchantMatch.index) : raw;
  const category = detectCategory(categoryText);

  // Extra qualifiers outside the closed grammar must go to the Brain rather
  // than being silently ignored as an overall-spend lookup.
  const bare = /^(?:nino\s+)?quanto(?:\s+que)?\s+(?:eu\s+)?gastei$/i.test(raw);
  if (!bare && !category && !merchant) return null;

  const filters = [
    ...(category ? [{ field: "category" as const, value: category }] : []),
    ...(merchant ? [{ field: "merchant" as const, value: merchant }] : []),
  ];
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "read",
    domain: "financial_read",
    canonical_request: raw,
    inherit_focus: false,
    focus: {
      category,
      merchant,
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
      entity: filters.length ? "resolved" : "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "lookup",
      queries: [{
        metric: "expense_amount",
        operation: "sum",
        group_by: [],
        filters,
        limit: null,
      }],
    },
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

  const monthlyExpense = directMonthlyExpenseLookup(text, normalized);
  if (monthlyExpense) return monthlyExpense;

  const directExpense = directExpenseLookup(text, normalized);
  if (directExpense) return directExpense;

  const exact = EXACT_READS.get(normalized);
  if (!exact) return null;

  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "read",
    domain: "financial_read",
    canonical_request: exact.canonical,
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
        metric: exact.metric,
        operation: "value",
        group_by: [],
        filters: [],
        limit: null,
      }],
    },
    advisory_kind: null,
  });
}
