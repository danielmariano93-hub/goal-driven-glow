// ConversationTurnContract (`nino_conversation_brain.v2`)
//
// Contrato CANÔNICO único entre entendimento conversacional e runtime.
// A LLM pode interpretar linguagem; depois daqui nenhuma camada pode mudar o
// significado do turno. Contratos de domínio (ex.: financial_read_contract.v4)
// são derivados deste contrato e nunca competem com ele.
//
// v1 continua aceito apenas como formato de entrada para compatibilidade.
// normalizeConversationTurnContract() sempre devolve v2.
// No numeric self-confidence is used for routing. Each relevant slot has an
// explicit resolution state: resolved | ambiguous | missing | conflicting |
// not_applicable.

import { isActionKind, type ActionIR } from "./ActionIR.ts";

export const BRAIN_ACTS = [
  "new_request", "follow_up", "repair", "answer", "topic_switch", "conversational",
] as const;
export type BrainAct = typeof BRAIN_ACTS[number];

export const BRAIN_MODES = ["converse", "read", "write", "clarify"] as const;
export type BrainMode = typeof BRAIN_MODES[number];

export const TURN_DOMAINS = [
  "conversation", "financial_read", "financial_write", "advisory",
] as const;
export type TurnDomain = typeof TURN_DOMAINS[number];

export const ADVISORY_KINDS = [
  "next_best_action", "goal_strategy", "wealth_opportunity", "financial_plan",
] as const;
export type AdvisoryKind = typeof ADVISORY_KINDS[number];

export const RESOLUTION_STATES = [
  "resolved", "ambiguous", "missing", "conflicting", "not_applicable",
] as const;
export type ResolutionState = typeof RESOLUTION_STATES[number];

export type TurnResolution = {
  intent: ResolutionState;
  reference: ResolutionState;
  time: ResolutionState;
  entity: ResolutionState;
  action: ResolutionState;
};

export const REFERENCE_KINDS = [
  "none", "previous_result_set", "previous_entity", "quoted_turn", "active_topic",
] as const;
export type ReferenceKind = typeof REFERENCE_KINDS[number];

export const REFERENCE_TARGETS = [
  "category", "merchant", "card", "account", "goal", "generic",
] as const;
export type ReferenceTarget = typeof REFERENCE_TARGETS[number];

export type TurnReference = {
  kind: ReferenceKind;
  target: ReferenceTarget;
  /** Expressão literal usada pelo usuário: "delas", "essa categoria", etc. */
  expression: string | null;
  status: ResolutionState;
};

export type BrainFocus = {
  category: string | null;
  merchant: string | null;
  goal: string | null;
  /** Primeira expressão temporal (compatibilidade retroativa). */
  period_expression: string | null;
  /**
   * TODAS as expressões temporais do pedido, na ordem em que aparecem.
   * Datas são resolvidas no backend, nunca pela LLM.
   */
  period_expressions?: string[];
};

export type ConversationTurnContract = {
  version: "conversation_turn_contract.v1" | "conversation_turn_contract.v2";
  act: BrainAct;
  mode: BrainMode;
  /** Domínio conversacional de alto nível. Não escolhe tool/engine. */
  domain?: TurnDomain;
  canonical_request: string | null;
  inherit_focus: boolean;
  focus: BrainFocus;
  action: ActionIR | null;
  direct_reply: string | null;
  clarification_question: string | null;
  /** Estado explícito por slot; autoridade para decidir se pode seguir. */
  resolution?: TurnResolution;
  /** Referência conversacional estruturada; grounding resolve para entidades reais. */
  reference?: TurnReference | null;
  /** Subtipo advisory emitido pela mesma autoridade conversacional. */
  advisory_kind?: AdvisoryKind | null;
  /**
   * @deprecated Compatibilidade com fixtures/telemetria v1. Nunca usar para
   * roteamento, autorização, execução ou decisão de clarificação.
   */
  confidence?: number;
};

export type CanonicalConversationTurnContract = ConversationTurnContract & {
  version: "conversation_turn_contract.v2";
  domain: TurnDomain;
  resolution: TurnResolution;
  reference: TurnReference | null;
  advisory_kind: AdvisoryKind | null;
};

export function normalizePeriodExpressions(focus: unknown): string[] {
  const raw = (focus ?? {}) as Record<string, unknown>;
  const list = Array.isArray(raw.period_expressions) ? raw.period_expressions : [];
  const single = raw.period_expression == null ? [] : [raw.period_expression];
  const out: string[] = [];
  for (const item of [...list, ...single]) {
    const value = String(item ?? "").trim();
    if (!value) continue;
    if (out.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue;
    out.push(value);
  }
  return out;
}

function resolutionState(value: unknown, fallback: ResolutionState): ResolutionState {
  const state = String(value ?? "");
  return RESOLUTION_STATES.includes(state as ResolutionState) ? state as ResolutionState : fallback;
}

function inferDomain(mode: BrainMode, rawDomain: unknown): TurnDomain {
  const domain = String(rawDomain ?? "");
  if (TURN_DOMAINS.includes(domain as TurnDomain)) return domain as TurnDomain;
  if (mode === "write") return "financial_write";
  if (mode === "read") return "financial_read";
  return "conversation";
}

function normalizeReference(raw: unknown): TurnReference | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind = REFERENCE_KINDS.includes(String(value.kind) as ReferenceKind)
    ? String(value.kind) as ReferenceKind
    : "none";
  if (kind === "none") return null;
  const target = REFERENCE_TARGETS.includes(String(value.target) as ReferenceTarget)
    ? String(value.target) as ReferenceTarget
    : "generic";
  return {
    kind,
    target,
    expression: value.expression == null ? null : String(value.expression).trim(),
    status: resolutionState(value.status, "missing"),
  };
}

function inferResolution(args: {
  raw: any;
  mode: BrainMode;
  action: ActionIR | null;
  focus: BrainFocus;
  reference: TurnReference | null;
}): TurnResolution {
  const declared = args.raw?.resolution ?? {};
  const hasEntity = Boolean(args.focus.category || args.focus.merchant || args.focus.goal);
  const hasTime = normalizePeriodExpressions(args.focus).length > 0;
  const refFallback: ResolutionState = args.reference
    ? args.reference.status
    : "not_applicable";

  return {
    intent: resolutionState(
      declared.intent,
      args.mode === "clarify" ? "ambiguous" : "resolved",
    ),
    reference: resolutionState(declared.reference, refFallback),
    time: resolutionState(declared.time, hasTime ? "resolved" : "not_applicable"),
    entity: resolutionState(declared.entity, hasEntity ? "resolved" : "not_applicable"),
    action: resolutionState(
      declared.action,
      args.mode === "write" ? (args.action ? "resolved" : "missing") : "not_applicable",
    ),
  };
}

export function normalizeConversationTurnContract(raw: unknown): CanonicalConversationTurnContract | null {
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
  const act = value.act as BrainAct;
  const inheritFocus = Boolean(value.inherit_focus);

  if (mode === "write" && !action) return null;
  if (mode !== "write" && action) return null;
  if (mode === "read" && !String(value.canonical_request ?? "").trim()) return null;
  if (mode === "clarify" && !String(value.clarification_question ?? "").trim()) return null;
  if (mode === "converse" && !String(value.direct_reply ?? "").trim()) return null;

  if ((act === "follow_up" || act === "answer" || act === "repair") && !inheritFocus) return null;
  if (act === "topic_switch" && inheritFocus) return null;

  const periodExpressions = normalizePeriodExpressions(value.focus);
  const focus: BrainFocus = {
    category: value.focus?.category == null ? null : String(value.focus.category).trim(),
    merchant: value.focus?.merchant == null ? null : String(value.focus.merchant).trim(),
    goal: value.focus?.goal == null ? null : String(value.focus.goal).trim(),
    period_expression: periodExpressions[0] ?? null,
    period_expressions: periodExpressions,
  };
  const reference = normalizeReference(value.reference);
  const resolution = inferResolution({ raw: value, mode, action, focus, reference });
  const domain = inferDomain(mode, value.domain);
  const advisoryKind = ADVISORY_KINDS.includes(String(value.advisory_kind) as AdvisoryKind)
    ? String(value.advisory_kind) as AdvisoryKind
    : null;
  if (domain === "advisory" && !advisoryKind) return null;
  if (domain !== "advisory" && advisoryKind) return null;

  // Fail closed on explicit unresolved semantics. Clarify is the only mode that
  // may intentionally carry ambiguous/missing/conflicting intent/reference.
  const unresolved = Object.values(resolution).some(
    (state) => state === "ambiguous" || state === "missing" || state === "conflicting",
  );
  if (mode !== "clarify" && resolution.intent !== "resolved") return null;
  if (mode !== "clarify" && reference && resolution.reference !== "resolved") return null;
  if (mode === "write" && resolution.action !== "resolved") return null;
  // Entity/time may be not_applicable; if declared unresolved for a READ, the
  // Brain must clarify before execution.
  if (mode === "read" && unresolved
    && [resolution.time, resolution.entity].some((s) => ["ambiguous", "missing", "conflicting"].includes(s))) {
    return null;
  }

  return {
    version: "conversation_turn_contract.v2",
    act,
    mode,
    domain,
    canonical_request: value.canonical_request == null ? null : String(value.canonical_request).trim(),
    inherit_focus: inheritFocus,
    focus,
    action,
    direct_reply: value.direct_reply == null ? null : String(value.direct_reply).trim(),
    clarification_question: value.clarification_question == null ? null : String(value.clarification_question).trim(),
    resolution,
    reference,
    advisory_kind: advisoryKind,
  };
}

export function dialogueActsFromContract(contract: ConversationTurnContract): string[] {
  if (contract.act === "repair") return ["repair"];
  if (contract.act === "follow_up" || contract.act === "answer") return ["followup"];
  if (contract.mode === "write") return ["write"];
  if (contract.mode === "converse") return ["conversational"];
  return ["new_query"];
}

export function validateConversationTurnContract(contract: ConversationTurnContract): string[] {
  const errors: string[] = [];
  if (contract.mode === "write" && !contract.action) errors.push("write_without_action");
  if (contract.mode !== "write" && contract.action) errors.push("action_outside_write");
  if (contract.mode === "read" && !contract.canonical_request) errors.push("read_without_canonical_request");
  if ((contract.act === "follow_up" || contract.act === "answer" || contract.act === "repair") && !contract.inherit_focus) {
    errors.push("continuation_without_focus_inheritance");
  }
  if (contract.act === "topic_switch" && contract.inherit_focus) errors.push("topic_switch_inherits_old_focus");

  const canonical = normalizeConversationTurnContract(contract);
  if (!canonical) errors.push("contract_not_canonicalizable");
  else {
    if (canonical.mode !== "clarify" && canonical.resolution.intent !== "resolved") errors.push("intent_not_resolved");
    if (canonical.reference && canonical.resolution.reference !== "resolved") errors.push("reference_not_resolved");
  }
  return [...new Set(errors)];
}
