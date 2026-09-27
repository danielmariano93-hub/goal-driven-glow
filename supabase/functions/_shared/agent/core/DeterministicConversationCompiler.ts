// Final deterministic compiler boundary.
// Keeps the broad fail-closed fast-path small while hardening phrases that have
// already appeared in production/adversarial tests. No provider call happens here.

import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "./ConversationTurnContract.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import { deterministicConversationFastPath } from "./DeterministicConversationFastPath.ts";

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function brMoney(raw: string): number | null {
  let s = String(raw ?? "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function writeContract(text: string, action: string, slots: Record<string, unknown>): CanonicalConversationTurnContract | null {
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "write",
    domain: "financial_write",
    canonical_request: text,
    inherit_focus: false,
    focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
    action: { action, slots },
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved", reference: "not_applicable", time: "not_applicable",
      entity: "resolved", action: "resolved",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  });
}

function monthlySeriesContract(text: string, memory: ConversationMemory): CanonicalConversationTurnContract | null {
  const t = norm(text);
  if (!/\b(?:mes a mes|mes por mes)\b/.test(t)) return null;
  const period = t.match(/\bultimos?\s+(\d+|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|doze)\s+meses\b/)?.[0] ?? null;
  if (!period) return null;
  const category = memory.active_category ?? null;
  if (!category) return null;

  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "read",
    domain: "financial_read",
    canonical_request: text,
    inherit_focus: true,
    focus: {
      category,
      merchant: memory.active_merchant ?? null,
      goal: null,
      period_expression: period,
      period_expressions: [period],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved", reference: "not_applicable", time: "resolved",
      entity: "resolved", action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "lookup",
      queries: [{
        metric: "expense_amount",
        operation: "trend",
        group_by: ["month"],
        filters: [
          { field: "category", op: "eq", value: category },
          ...(memory.active_merchant ? [{ field: "merchant", op: "eq", value: memory.active_merchant }] : []),
        ],
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

export function compileDeterministicConversationTurn(args: {
  text: string;
  memory: ConversationMemory | null;
}): CanonicalConversationTurnContract | null {
  const text = String(args.text ?? "").trim();
  const t = norm(text);

  // "Registra R$300 de pagamento na dívida do Lucas" is a payment, never an
  // expense transaction. Require all three anchors so ambiguous "registra 300"
  // still falls through to the normal classifier.
  if (/\b(?:registra|registre|registrar|paguei|paga|pague)\b/.test(t)
    && /\bpagamento\b/.test(t) && /\bdivida\b/.test(t)) {
    const amountRaw = /r\$\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/i.exec(text)?.[1] ?? "";
    const amount = brMoney(amountRaw);
    const debt = /d[ií]vida\s+(?:do|da|com)\s+(.+?)[?.!]*$/i.exec(text)?.[1]?.trim() ?? "";
    if (amount != null && amount > 0 && debt) {
      return writeContract(text, "debt.pay", { debt, amount });
    }
  }

  if (args.memory) {
    const monthly = monthlySeriesContract(text, args.memory);
    if (monthly) return monthly;
  }

  return deterministicConversationFastPath(args);
}
