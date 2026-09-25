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
import {
  COMPARISON_BASELINES, COMPARISON_DIRECTIONS, FINANCIAL_DIMENSIONS, FINANCIAL_METRICS, FINANCIAL_OPERATIONS,
  type ComparisonBaseline, type ComparisonDirection, type FinancialDimension, type FinancialFilter, type FinancialMetric, type FinancialOperation,
} from "./FinancialQueryIR.ts";

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
  "current_insight", "next_best_action", "goal_strategy", "wealth_opportunity", "financial_plan",
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

/** Internal marker emitted only by deterministic evidence-backed responders.
 * ConversationBrain is instructed to preserve the user's literal reference, so
 * LLM-generated direct replies cannot satisfy this proof marker accidentally. */
export const GROUNDED_FINANCIAL_EVIDENCE_MARKER = "__nino_grounded_financial_evidence_v1__";

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
   * TODAS as expressões temporais relevantes. Em comparação, baseline/target
   * são declarados separadamente na query financeira.
   * Datas são resolvidas no backend, nunca pela LLM.
   */
  period_expressions?: string[];
};

export type FinancialReadSemanticQuery = {
  metric: FinancialMetric;
  operation: FinancialOperation;
  group_by: FinancialDimension[];
  filters: FinancialFilter[];
  limit: number | null;
  /** Sinal pedido pelo usuário em uma comparação agrupada. */
  comparison_direction?: ComparisonDirection;
  /** Tipo de baseline: outro período ou média dos meses anteriores ao alvo. */
  comparison_baseline?: ComparisonBaseline;
  comparison_baseline_window?: number | null;
  /**
   * Papéis temporais explícitos da comparação. São expressões humanas, não
   * datas. O backend apenas resolve os intervalos, sem reinterpretar o papel.
   */
  comparison_baseline_expression?: string | null;
  comparison_target_expression?: string | null;
};

export type FinancialReadSemanticRequest = {
  intent: "lookup" | "analyze" | "investigate";
  queries: FinancialReadSemanticQuery[];
};

/**
 * Contrato público CANÔNICO. Compatibilidade com payloads v1 existe somente na
 * fronteira de normalizeConversationTurnContract(raw: unknown); v1 e confidence
 * numérico não fazem parte do tipo que o runtime pode consumir.
 */
export type ConversationTurnContract = {
  version: "conversation_turn_contract.v2";
  act: BrainAct;
  mode: BrainMode;
  /** Domínio conversacional de alto nível. Não escolhe tool/engine. */
  domain: TurnDomain;
  canonical_request: string | null;
  inherit_focus: boolean;
  focus: BrainFocus;
  action: ActionIR | null;
  direct_reply: string | null;
  clarification_question: string | null;
  /** Estado explícito por slot; autoridade para decidir se pode seguir. */
  resolution: TurnResolution;
  /** Referência conversacional estruturada; grounding resolve para entidades reais. */
  reference: TurnReference | null;
  /**
   * Semântica financeira de alto nível emitida pela MESMA autoridade. Não tem
   * datas resolvidas, IDs nem tools; o backend traduz para Financial IR v3.
   */
  financial_read: FinancialReadSemanticRequest | null;
  /** Subtipo advisory emitido pela mesma autoridade conversacional. */
  advisory_kind: AdvisoryKind | null;
};

export type CanonicalConversationTurnContract = ConversationTurnContract;

export function comparisonPeriodExpressions(
  turn: Pick<ConversationTurnContract, "financial_read">,
): [string, string] | null {
  const query = turn.financial_read?.queries.find((q) => q.operation === "compare") ?? null;
  if ((query?.comparison_baseline ?? "period") !== "period") return null;
  const baseline = query?.comparison_baseline_expression?.trim() || null;
  const target = query?.comparison_target_expression?.trim() || null;
  return baseline && target ? [baseline, target] : null;
}

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

function normalizeFinancialRead(raw: unknown): FinancialReadSemanticRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const intent = String(value.intent ?? "");
  if (!["lookup", "analyze", "investigate"].includes(intent)) return null;
  const queriesRaw = Array.isArray(value.queries) ? value.queries : [];
  if (queriesRaw.length < 1 || queriesRaw.length > 4) return null;
  const queries: FinancialReadSemanticQuery[] = [];
  for (const item of queriesRaw) {
    if (!item || typeof item !== "object") return null;
    const q = item as Record<string, unknown>;
    const metric = String(q.metric ?? "") as FinancialMetric;
    const operation = String(q.operation ?? "") as FinancialOperation;
    if (!FINANCIAL_METRICS.includes(metric) || !FINANCIAL_OPERATIONS.includes(operation)) return null;
    const groupBy = Array.isArray(q.group_by) ? q.group_by.map(String) : [];
    if (groupBy.length > 1 || groupBy.some((d) => !FINANCIAL_DIMENSIONS.includes(d as FinancialDimension))) return null;
    const filtersRaw = Array.isArray(q.filters) ? q.filters : [];
    const filters: FinancialFilter[] = [];
    for (const rawFilter of filtersRaw) {
      if (!rawFilter || typeof rawFilter !== "object") return null;
      const filter = rawFilter as Record<string, unknown>;
      const field = String(filter.field ?? "") as FinancialFilter["field"];
      const filterValue = String(filter.value ?? "").trim();
      if (!["category", "card", "account", "payment_method"].includes(field) || !filterValue) return null;
      filters.push({ field, op: "eq", value: filterValue });
    }
    const limit = q.limit == null ? null : Number(q.limit);
    if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 20)) return null;
    const rawDirection = String(q.comparison_direction ?? "any") as ComparisonDirection;
    if (!COMPARISON_DIRECTIONS.includes(rawDirection)) return null;
    const rawBaselineKind = String(q.comparison_baseline ?? "period") as ComparisonBaseline;
    if (!COMPARISON_BASELINES.includes(rawBaselineKind)) return null;
    const baselineWindow = q.comparison_baseline_window == null ? null : Number(q.comparison_baseline_window);
    if (rawBaselineKind === "mean_previous_complete_months"
      && (!Number.isInteger(baselineWindow) || Number(baselineWindow) < 2 || Number(baselineWindow) > 24)) return null;
    const baseline = q.comparison_baseline_expression == null
      ? null
      : String(q.comparison_baseline_expression).trim() || null;
    const target = q.comparison_target_expression == null
      ? null
      : String(q.comparison_target_expression).trim() || null;
    // Comparação período-a-período exige os dois papéis. Média histórica usa
    // apenas o período alvo; a janela histórica é derivada deterministicamente.
    if (operation === "compare" && rawBaselineKind === "period" && Boolean(baseline) !== Boolean(target)) return null;
    queries.push({
      metric,
      operation,
      group_by: groupBy as FinancialDimension[],
      filters,
      limit,
      comparison_direction: operation === "compare" ? rawDirection : "any",
      comparison_baseline: operation === "compare" ? rawBaselineKind : "period",
      comparison_baseline_window: operation === "compare" && rawBaselineKind === "mean_previous_complete_months"
        ? baselineWindow
        : null,
      comparison_baseline_expression: operation === "compare" && rawBaselineKind === "period" ? baseline : null,
      comparison_target_expression: operation === "compare" ? target : null,
    });
  }
  return { intent: intent as FinancialReadSemanticRequest["intent"], queries };
}

function normalizedReply(text: unknown): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A conversational LLM may explain generic finance, but it may not assert a
 * PERSONAL numeric result or the methodology of a personal analysis from prose
 * memory. This invariant applies to EVERY conversational act, not only follow-up:
 * a new request such as "qual insight para hoje?" may not hallucinate a personal
 * fact merely because history happens to contain one.
 */
function looksLikePersonalFinancialAssertion(text: unknown): boolean {
  const value = normalizedReply(text);
  if (!value) return false;
  const moneyOrPct = /r\$\s*\d|\b\d+[.,]\d{1,2}\s*%/.test(value);
  const financeContext = /\b(?:saldo|fatura|patrimonio|gasto|despesa|receita|divida|categoria|media|total|acima|abaixo)\b/.test(value);
  const executedMethodology = /\b(?:estou comparando|estamos comparando|esses valores|os valores)\b.*\b(?:media|mensal|total|periodo)\b/.test(value)
    || /\b(?:total gasto|media mensal|medias mensais|acima da media|abaixo da media)\b/.test(value);
  return (moneyOrPct && financeContext) || executedMethodology;
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
  const financialRead = normalizeFinancialRead(value.financial_read);
  const explicitV2 = String(value.version ?? "") === "conversation_turn_contract.v2";

  // Make impossible semantic states unrepresentable at the canonical boundary.
  // READ may be factual or advisory, WRITE is financial mutation, and CONVERSE
  // is data-free conversation. Clarify may retain the domain being clarified.
  if (mode === "read" && domain !== "financial_read" && domain !== "advisory") return null;
  if (mode === "write" && domain !== "financial_write") return null;
  if (mode === "converse" && domain !== "conversation") return null;

  if (domain === "advisory" && !advisoryKind) return null;
  if (domain !== "advisory" && advisoryKind) return null;
  if (explicitV2 && domain === "financial_read" && !financialRead) return null;
  if (domain !== "financial_read" && financialRead) return null;

  // Personal financial truth may never escape through free-form conversation.
  // Only an evidence-backed deterministic responder can carry the proof marker.
  const groundedFinancialDirectReply = mode === "converse"
    && reference?.kind === "previous_result_set"
    && reference.expression === GROUNDED_FINANCIAL_EVIDENCE_MARKER
    && resolution.reference === "resolved";
  if (mode === "converse"
    && looksLikePersonalFinancialAssertion(value.direct_reply)
    && !groundedFinancialDirectReply) {
    return null;
  }

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
    financial_read: financialRead,
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
