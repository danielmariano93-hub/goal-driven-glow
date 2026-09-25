// Deterministic diagnostics for ConversationTurnContract failures.
//
// The semantic model is allowed to interpret language once, but validation is
// software. When a candidate is rejected, repair must know WHICH invariant was
// violated instead of receiving an opaque `contract_invalid` and guessing again.
// This module never changes meaning and never repairs data; it only explains why
// the canonical validator rejected a candidate.
import { isActionKind } from "./ActionIR.ts";
import {
  ADVISORY_KINDS,
  BRAIN_ACTS,
  BRAIN_MODES,
  REFERENCE_KINDS,
  RESOLUTION_STATES,
  TURN_DOMAINS,
  normalizeConversationTurnContract,
  type BrainAct,
  type BrainMode,
  type ResolutionState,
  type TurnDomain,
} from "./ConversationTurnContract.ts";

export const CONVERSATION_CONTRACT_REASON_CODES = [
  "not_object",
  "invalid_act",
  "invalid_mode",
  "invalid_domain",
  "read_domain_mismatch",
  "write_domain_mismatch",
  "converse_domain_mismatch",
  "write_without_action",
  "action_outside_write",
  "read_without_canonical_request",
  "clarify_without_question",
  "converse_without_direct_reply",
  "continuation_without_focus_inheritance",
  "topic_switch_inherits_focus",
  "advisory_kind_missing",
  "advisory_kind_unexpected",
  "financial_read_missing_or_invalid",
  "financial_read_outside_domain",
  "intent_unresolved",
  "reference_unresolved",
  "write_action_unresolved",
  "read_time_unresolved",
  "read_entity_unresolved",
  "contract_not_canonicalizable",
] as const;

export type ConversationContractReasonCode = typeof CONVERSATION_CONTRACT_REASON_CODES[number];

export type ConversationContractDiagnosis = {
  valid: boolean;
  reasons: ConversationContractReasonCode[];
};

const UNRESOLVED = new Set<ResolutionState>(["ambiguous", "missing", "conflicting"]);

function validResolution(value: unknown, fallback: ResolutionState): ResolutionState {
  const text = String(value ?? "");
  return RESOLUTION_STATES.includes(text as ResolutionState) ? text as ResolutionState : fallback;
}

function hasValidFinancialReadShape(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  if (!["lookup", "analyze", "investigate"].includes(String(value.intent ?? ""))) return false;
  const queries = Array.isArray(value.queries) ? value.queries : [];
  return queries.length >= 1 && queries.length <= 4 && queries.every((item) => item && typeof item === "object");
}

export function diagnoseConversationTurnContract(raw: unknown): ConversationContractDiagnosis {
  // If the canonical validator accepts it, diagnostics must never invent a reason.
  if (normalizeConversationTurnContract(raw)) return { valid: true, reasons: [] };

  const reasons: ConversationContractReasonCode[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, reasons: ["not_object"] };
  }

  const value = raw as Record<string, unknown>;
  const actText = String(value.act ?? "");
  const modeText = String(value.mode ?? "");
  const domainText = String(value.domain ?? "");
  const validAct = BRAIN_ACTS.includes(actText as BrainAct);
  const validMode = BRAIN_MODES.includes(modeText as BrainMode);
  const validDomain = TURN_DOMAINS.includes(domainText as TurnDomain);

  if (!validAct) reasons.push("invalid_act");
  if (!validMode) reasons.push("invalid_mode");
  if (!validDomain) reasons.push("invalid_domain");
  if (!validAct || !validMode) return { valid: false, reasons };

  const act = actText as BrainAct;
  const mode = modeText as BrainMode;
  const domain = validDomain
    ? domainText as TurnDomain
    : mode === "write" ? "financial_write" : mode === "read" ? "financial_read" : "conversation";
  const action = value.action && typeof value.action === "object"
    && isActionKind((value.action as Record<string, unknown>).action)
    ? value.action
    : null;
  const inheritFocus = Boolean(value.inherit_focus);

  if (mode === "read" && domain !== "financial_read" && domain !== "advisory") reasons.push("read_domain_mismatch");
  if (mode === "write" && domain !== "financial_write") reasons.push("write_domain_mismatch");
  if (mode === "converse" && domain !== "conversation") reasons.push("converse_domain_mismatch");

  if (mode === "write" && !action) reasons.push("write_without_action");
  if (mode !== "write" && action) reasons.push("action_outside_write");
  if (mode === "read" && !String(value.canonical_request ?? "").trim()) reasons.push("read_without_canonical_request");
  if (mode === "clarify" && !String(value.clarification_question ?? "").trim()) reasons.push("clarify_without_question");
  if (mode === "converse" && !String(value.direct_reply ?? "").trim()) reasons.push("converse_without_direct_reply");
  if (["follow_up", "answer", "repair"].includes(act) && !inheritFocus) reasons.push("continuation_without_focus_inheritance");
  if (act === "topic_switch" && inheritFocus) reasons.push("topic_switch_inherits_focus");

  const advisoryKind = String(value.advisory_kind ?? "");
  const hasAdvisoryKind = ADVISORY_KINDS.includes(advisoryKind as never);
  if (domain === "advisory" && !hasAdvisoryKind) reasons.push("advisory_kind_missing");
  if (domain !== "advisory" && hasAdvisoryKind) reasons.push("advisory_kind_unexpected");

  const financialReadPresent = value.financial_read != null;
  if (domain === "financial_read" && !hasValidFinancialReadShape(value.financial_read)) {
    reasons.push("financial_read_missing_or_invalid");
  }
  if (domain !== "financial_read" && financialReadPresent) reasons.push("financial_read_outside_domain");

  const reference = value.reference && typeof value.reference === "object"
    ? value.reference as Record<string, unknown>
    : null;
  const referenceKind = String(reference?.kind ?? "none");
  const hasReference = REFERENCE_KINDS.includes(referenceKind as never) && referenceKind !== "none";
  const declared = value.resolution && typeof value.resolution === "object"
    ? value.resolution as Record<string, unknown>
    : {};
  const intent = validResolution(declared.intent, mode === "clarify" ? "ambiguous" : "resolved");
  const referenceState = validResolution(
    declared.reference,
    hasReference ? validResolution(reference?.status, "missing") : "not_applicable",
  );
  const actionState = validResolution(declared.action, mode === "write" ? (action ? "resolved" : "missing") : "not_applicable");
  const timeState = validResolution(declared.time, "not_applicable");
  const entityState = validResolution(declared.entity, "not_applicable");

  if (mode !== "clarify" && intent !== "resolved") reasons.push("intent_unresolved");
  if (mode !== "clarify" && hasReference && referenceState !== "resolved") reasons.push("reference_unresolved");
  if (mode === "write" && actionState !== "resolved") reasons.push("write_action_unresolved");
  if (mode === "read" && UNRESOLVED.has(timeState)) reasons.push("read_time_unresolved");
  if (mode === "read" && UNRESOLVED.has(entityState)) reasons.push("read_entity_unresolved");

  if (reasons.length === 0) reasons.push("contract_not_canonicalizable");
  return { valid: false, reasons: [...new Set(reasons)] };
}

export function conversationContractRepairHint(raw: unknown): string {
  const diagnosis = diagnoseConversationTurnContract(raw);
  if (diagnosis.valid) return "";
  return `INVALID_REASONS: ${diagnosis.reasons.join(", ")}`;
}
