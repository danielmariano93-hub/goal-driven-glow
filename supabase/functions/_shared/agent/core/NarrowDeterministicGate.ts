// NarrowDeterministicGate (`nino_fast_contract.v1`)
//
// Latency fast path for a deliberately tiny set of 100% unambiguous reads.
// It does NOT create another intent router: it emits the exact same canonical
// ConversationTurnContract v2 used by the Conversation Brain. Anything outside
// these exact shapes goes to the Brain.

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

export function resolveNarrowDeterministicTurn(
  text: string,
): CanonicalConversationTurnContract | null {
  const canonical = EXACT_READS.get(norm(text));
  if (!canonical) return null;

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
    advisory_kind: null,
  });
}
