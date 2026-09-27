// Runtime V3 semantic authority for Nino.
//
// V3 owns natural-language interpretation when `runtime_v3_authority_v1` is
// enabled. The mature V2 execution runtime remains the deterministic executor
// for financial engines, writes, evidence and memory. V2 ConversationBrain is
// retained only as a circuit breaker when V3 cannot emit/bridge a safe contract.
// deno-lint-ignore-file no-explicit-any

import { isEnabled } from "./FeatureFlags.ts";
import {
  interpretConversationTurn as interpretConversationTurnV2,
  type ConversationBrainOutcome,
} from "./ConversationBrain.ts";
import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
  type TurnReference,
} from "./ConversationTurnContract.ts";
import { detectCategory } from "./ConversationMemory.ts";
import { deterministicConversationFastPath } from "./DeterministicConversationFastPath.ts";
import { interpretSemanticTurnV3 } from "../v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../v3/V3RuntimeBridge.ts";
import type { TurnSpecV3 } from "../v3/TurnSpecV3.ts";

export { dialogueActsFromContract } from "./ConversationBrain.ts";
export type { ConversationTurnContract } from "./ConversationBrain.ts";

const V3_MODEL = "openai/gpt-oss-120b";
type AuthorityInput = Parameters<typeof interpretConversationTurnV2>[0];

function historyText(history: AuthorityInput["history"]): string {
  return (history ?? []).slice(-12).map((turn) => {
    const role = turn.role === "user" ? "Usuário" : "Nino";
    return `${role}: ${String(turn.content ?? "").trim().slice(0, 700)}`;
  }).join("\n").slice(0, 7000);
}

function typedContextText(input: AuthorityInput): string {
  const memory = input.memory;
  const workflow = input.workflow;
  const context = {
    relationship_context: input.user_context ? String(input.user_context).slice(0, 4200) : null,
    conversation_state: memory ? {
      current_topic: memory.current_topic ?? null,
      active_category: memory.active_category ?? null,
      active_merchant: memory.active_merchant ?? null,
      active_period: memory.active_period ?? null,
      comparison_period: memory.comparison_period ?? null,
      awaiting: memory.awaiting ?? null,
      pending_conversation_action: memory.pending_conversation_action ?? null,
      active_references: (memory.references ?? []).filter((ref) => ref.status === "active").slice(-5).map((ref) => ({
        target: ref.target,
        entity_labels: ref.entity_labels,
        source_tool: ref.source?.tool_name ?? null,
      })),
    } : null,
    workflow: workflow ? {
      kind: (workflow as any).kind ?? null,
      status: (workflow as any).status ?? null,
      slots: (workflow as any).slots ?? null,
    } : null,
  };
  return JSON.stringify(context).slice(0, 7000);
}

function zeroCallTelemetry(model: string): ConversationBrainOutcome["telemetry"] {
  return {
    model,
    provider: null,
    llm_calls: 0,
    tokens_in: 0,
    tokens_out: 0,
    latency_ms: 0,
    ok: true,
    error: null,
  };
}

function contextualMonthlyChartFastPath(input: AuthorityInput): ConversationBrainOutcome | null {
  const text = String(input.text ?? "").trim();
  if (!/\b(?:gr[aá]fico|chart)\b/i.test(text)) return null;
  const memory = input.memory;
  if (!memory) return null;

  const refs = (memory.references ?? []).filter((ref: any) =>
    ref.status === "active" && ref.source?.context?.evidence?.kind === "monthly_series"
  );
  const ref = refs[refs.length - 1] as any;
  const evidence = ref?.source?.context?.evidence as any;
  if (!evidence?.months?.length) return null;

  // Explicitly requesting a different time horizon must execute a new query.
  if (/\b(?:[uú]ltim[oa]s?\s+\d+\s+mes|\d+\s+meses|20\d{2}|de\s+\w+\s+a\s+\w+)\b/i.test(text)) return null;
  const explicitCategory = detectCategory(text);
  const evidenceCategory = String(evidence?.scope?.category ?? "").trim();
  if (explicitCategory && evidenceCategory && explicitCategory.toLowerCase() !== evidenceCategory.toLowerCase()) return null;

  const contract = normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "converse",
    domain: "conversation",
    canonical_request: "Exibir em gráfico a série mensal já calculada no contexto atual.",
    inherit_focus: true,
    focus: {
      category: evidenceCategory || memory.active_category || null,
      merchant: evidence?.scope?.merchant ?? memory.active_merchant ?? null,
      goal: null,
      period_expression: null,
      period_expressions: [],
    },
    action: null,
    direct_reply: "Claro — aqui está o gráfico. 📊",
    clarification_question: null,
    resolution: {
      intent: "resolved", reference: "not_applicable", time: "not_applicable",
      entity: evidenceCategory || memory.active_category || memory.active_merchant ? "resolved" : "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  });
  return contract ? { contract, telemetry: zeroCallTelemetry("deterministic:monthly-chart-followup.v1") } : null;
}

function temporalExpenseFastPath(input: AuthorityInput): ConversationBrainOutcome | null {
  const text = String(input.text ?? "").trim();
  const match = text.match(/^\s*(?:e\s+)?(?:no|em)?\s*(m[eê]s passado|m[eê]s anterior|este m[eê]s|esse m[eê]s|hoje)\s*[?.!]*\s*$/i);
  if (!match || !input.memory) return null;
  // Only reuse a known expense-analysis operation. Other previous operations
  // (income, balance, debt, goals, comparisons) must retain semantic authority.
  if (input.memory.last_tool_context?.tool !== "analyze_spending") return null;

  const periodExpression = match[1];
  const category = input.memory.active_category ?? null;
  const merchant = input.memory.active_merchant ?? null;
  const filters = [
    ...(category ? [{ field: "category" as const, op: "eq" as const, value: category }] : []),
    ...(merchant ? [{ field: "merchant" as const, op: "eq" as const, value: merchant }] : []),
  ];
  const subject = category ? ` com ${category}` : merchant ? ` em ${merchant}` : "";
  const contract = normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "read",
    domain: "financial_read",
    canonical_request: `Quanto gastei${subject} em ${periodExpression}?`,
    inherit_focus: true,
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
      intent: "resolved", reference: "not_applicable", time: "resolved",
      entity: category || merchant ? "resolved" : "not_applicable", action: "not_applicable",
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
        comparison_direction: "any",
        comparison_baseline: "period",
        comparison_baseline_window: null,
        comparison_baseline_expression: null,
        comparison_target_expression: null,
      }],
    },
    advisory_kind: null,
  });
  return contract ? { contract, telemetry: zeroCallTelemetry("deterministic:temporal-expense-followup.v1") } : null;
}

function safeUndoFastPath(input: AuthorityInput): ConversationBrainOutcome | null {
  const text = String(input.text ?? "").trim();
  if (!/^\s*(?:nino[,\s]+)?(?:desfaz(?:\s+isso|\s+o\s+[uú]ltimo|\s+a\s+[uú]ltima)?|desfa[cç]a(?:\s+isso)?|desfazer(?:\s+a\s+[uú]ltima\s+a[cç][aã]o)?|volta(?:r)?\s+atr[aá]s)\s*[?.!]*\s*$/i.test(text)) return null;
  const contract = normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "write",
    domain: "financial_write",
    canonical_request: "Desfazer com segurança a última ação confirmada, se houver uma reversão exata suportada.",
    inherit_focus: false,
    focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
    action: { action: "undo.last", slots: {} },
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved", reference: "not_applicable", time: "not_applicable",
      entity: "not_applicable", action: "resolved",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  });
  return contract ? { contract, telemetry: zeroCallTelemetry("deterministic:safe-undo.v1") } : null;
}

function referenceFromV3(turn: TurnSpecV3): TurnReference | null {
  const ref = turn.references[0] ?? null;
  if (!ref) return null;
  const kind: TurnReference["kind"] = ref.source === "quoted_turn"
    ? "quoted_turn"
    : ref.kind === "result_set_reference"
      ? "previous_result_set"
      : "previous_entity";
  return {
    kind,
    target: ref.target,
    expression: ref.expression,
    status: "resolved",
  };
}

/** Preserve V3's structured anaphora through the transitional V2 executor. */
export function attachV3ReferenceToContract(
  turn: TurnSpecV3,
  contract: CanonicalConversationTurnContract,
): CanonicalConversationTurnContract {
  const reference = referenceFromV3(turn);
  if (!reference) return contract;
  return {
    ...contract,
    reference,
    resolution: { ...contract.resolution, reference: "resolved" },
  };
}

function circuitBreakerTelemetry(
  v3: Awaited<ReturnType<typeof interpretSemanticTurnV3>>,
  fallback: ConversationBrainOutcome,
  reason: string,
): ConversationBrainOutcome["telemetry"] {
  return {
    ...fallback.telemetry,
    model: `v3-circuit-breaker:${reason}:${fallback.telemetry.model}`.slice(0, 180),
    llm_calls: Number(v3.telemetry.llm_calls ?? 0) + Number(fallback.telemetry.llm_calls ?? 0),
    tokens_in: Number(v3.telemetry.tokens_in ?? 0) + Number(fallback.telemetry.tokens_in ?? 0),
    tokens_out: Number(v3.telemetry.tokens_out ?? 0) + Number(fallback.telemetry.tokens_out ?? 0),
    latency_ms: Number(v3.telemetry.latency_ms ?? 0) + Number(fallback.telemetry.latency_ms ?? 0),
  };
}

export function isProviderCapacityFailure(reason: unknown): boolean {
  return /(?:structured_call_gateway_429|\b429\b|rate\s*limit|too\s+many\s+requests|structured_call_network|gateway_(?:500|502|503|504))/i
    .test(String(reason ?? ""));
}

function humanCapacityFallback(input: AuthorityInput, reason: string): ConversationBrainOutcome {
  const contract = normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "answer",
    mode: "converse",
    domain: "conversation",
    canonical_request: String(input.text ?? "").trim() || null,
    inherit_focus: false,
    focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
    action: null,
    direct_reply: "Não consegui fechar esse pedido agora. Pode me mandar a mesma mensagem novamente daqui a pouco?",
    clarification_question: null,
    resolution: {
      intent: "resolved", reference: "not_applicable", time: "not_applicable",
      entity: "not_applicable", action: "not_applicable",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  });
  return {
    contract,
    telemetry: {
      model: `provider-capacity:${reason}`.slice(0, 180),
      provider: null,
      llm_calls: 1,
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: 0,
      ok: false,
      error: reason,
    },
  };
}

export async function interpretConversationTurn(input: AuthorityInput): Promise<ConversationBrainOutcome> {
  // These shortcuts are independent of V3 rollout. They are narrow,
  // deterministic and backed by stored evidence/state, so every user benefits.
  const chart = contextualMonthlyChartFastPath(input);
  if (chart) return chart;
  const temporal = temporalExpenseFastPath(input);
  if (temporal) return temporal;
  const undo = safeUndoFastPath(input);
  if (undo) return undo;

  // High-confidence CRUD/read/write requests are compiled locally before any
  // provider call. Ambiguous language still falls through to semantic AI.
  const deterministic = deterministicConversationFastPath({ text: input.text, memory: input.memory });
  if (deterministic) {
    return {
      contract: deterministic,
      telemetry: zeroCallTelemetry("deterministic:known-financial-intent.v1"),
    };
  }

  const authorityEnabled = input.user_id
    ? await isEnabled("runtime_v3_authority_v1", input.user_id).catch(() => false)
    : false;
  if (!authorityEnabled) return await interpretConversationTurnV2(input);

  const v3 = await interpretSemanticTurnV3({
    text: input.text,
    history_text: historyText(input.history),
    context_text: typedContextText(input),
    model: input.model || V3_MODEL,
    provider_override: input.provider_override ?? null,
  });

  if (v3.turn) {
    const bridged = bridgeTurnSpecV3ToRuntime(v3.turn);
    if (bridged.ok) {
      return {
        contract: attachV3ReferenceToContract(v3.turn, bridged.contract),
        telemetry: {
          ...v3.telemetry,
          model: `v3-authority:${v3.telemetry.model}`,
        },
      };
    }
    const reason = `bridge:${bridged.errors.join("+")}`.slice(0, 120);
    console.warn("[ConversationAuthority] V3 bridge rejected; using circuit breaker", reason);
    const fallback = await interpretConversationTurnV2(input);
    return { contract: fallback.contract, telemetry: circuitBreakerTelemetry(v3, fallback, reason) };
  }

  const reason = String(v3.telemetry.error ?? v3.violations.join("+") ?? "contract_unavailable").slice(0, 120);
  console.warn("[ConversationAuthority] V3 unavailable", reason);

  // A 429/transport outage is not a semantic failure. Calling V2 against the
  // same provider here only doubles quota pressure and latency, so fail once in
  // human language. Real provider failover, when configured, already happens
  // inside the structured AI transport before control returns here.
  if (isProviderCapacityFailure(reason)) return humanCapacityFallback(input, reason);

  const fallback = await interpretConversationTurnV2(input);
  return { contract: fallback.contract, telemetry: circuitBreakerTelemetry(v3, fallback, reason) };
}
