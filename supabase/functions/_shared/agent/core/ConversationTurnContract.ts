// ConversationTurnContract (`nino_conversation_brain.v1`)
// Pure contract between the conversational authority and deterministic runtime.
// No DB, no LLM and no tools: this module is intentionally easy to unit-test.

import { isActionKind, type ActionIR } from "./ActionIR.ts";

export const BRAIN_ACTS = [
  "new_request", "follow_up", "repair", "answer", "topic_switch", "conversational",
] as const;
export type BrainAct = typeof BRAIN_ACTS[number];

export const BRAIN_MODES = ["converse", "read", "write", "clarify"] as const;
export type BrainMode = typeof BRAIN_MODES[number];

export type BrainFocus = {
  category: string | null;
  merchant: string | null;
  goal: string | null;
  period_expression: string | null;
};

export type ConversationTurnContract = {
  version: "conversation_turn_contract.v1";
  act: BrainAct;
  mode: BrainMode;
  canonical_request: string | null;
  inherit_focus: boolean;
  focus: BrainFocus;
  action: ActionIR | null;
  direct_reply: string | null;
  clarification_question: string | null;
  confidence: number;
};

export function normalizeConversationTurnContract(raw: unknown): ConversationTurnContract | null {
  const value = raw as any;
  if (!value
    || !BRAIN_ACTS.includes(String(value.act) as BrainAct)
    || !BRAIN_MODES.includes(String(value.mode) as BrainMode)) return null;

  const action = value.action && isActionKind(value.action.action)
    ? {
      version: "action_ir.v1" as const,
      action: value.action.action,
      slots: (value.action.slots ?? {}) as Record<string, unknown>,
    }
    : null;
  const mode = value.mode as BrainMode;

  // Cross-field invariants: invalid contracts fail closed instead of being
  // silently reinterpreted by the runtime.
  if (mode === "write" && !action) return null;
  if (mode !== "write" && action) return null;
  if (mode === "read" && !String(value.canonical_request ?? "").trim()) return null;
  if (mode === "clarify" && !String(value.clarification_question ?? "").trim()) return null;
  if (mode === "converse" && !String(value.direct_reply ?? "").trim()) return null;

  return {
    version: "conversation_turn_contract.v1",
    act: value.act as BrainAct,
    mode,
    canonical_request: value.canonical_request == null ? null : String(value.canonical_request).trim(),
    inherit_focus: Boolean(value.inherit_focus),
    focus: {
      category: value.focus?.category == null ? null : String(value.focus.category).trim(),
      merchant: value.focus?.merchant == null ? null : String(value.focus.merchant).trim(),
      goal: value.focus?.goal == null ? null : String(value.focus.goal).trim(),
      period_expression: value.focus?.period_expression == null ? null : String(value.focus.period_expression).trim(),
    },
    action,
    direct_reply: value.direct_reply == null ? null : String(value.direct_reply).trim(),
    clarification_question: value.clarification_question == null ? null : String(value.clarification_question).trim(),
    confidence: Math.max(0, Math.min(1, Number(value.confidence ?? 0))),
  };
}

export function dialogueActsFromContract(contract: ConversationTurnContract): string[] {
  if (contract.act === "repair") return ["repair"];
  if (contract.act === "follow_up" || contract.act === "answer") return ["followup"];
  if (contract.mode === "write") return ["write"];
  if (contract.mode === "converse") return ["conversational"];
  return ["new_query"];
}

/** Hard release invariants for golden conversation fixtures. */
export function validateConversationTurnContract(contract: ConversationTurnContract): string[] {
  const errors: string[] = [];
  if (contract.mode === "write" && !contract.action) errors.push("write_without_action");
  if (contract.mode !== "write" && contract.action) errors.push("action_outside_write");
  if (contract.mode === "read" && !contract.canonical_request) errors.push("read_without_canonical_request");
  if ((contract.act === "follow_up" || contract.act === "answer") && !contract.inherit_focus) {
    errors.push("continuation_without_focus_inheritance");
  }
  if (contract.act === "topic_switch" && contract.inherit_focus) errors.push("topic_switch_inherits_old_focus");
  return errors;
}
