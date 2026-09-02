// SemanticTurnPipeline (`nino_semantic_ir.v3`)
//
// ORQUESTRADOR de ponta a ponta do READ financeiro semântico. Existe como módulo
// próprio (e não inline no AgentCore) porque o fluxo precisa ser testável sem
// banco, sem LLM e sem Deno: todas as dependências entram injetadas.
//
// Ordem OBRIGATÓRIA do turno:
//   Topic State → Pending Clarification → Fast Path/Compiler → IR v2 →
//   Validator → SemanticStatus → Clarification | Executor → Engines →
//   Claims → Completeness → InvestigationLoop → Claims finais →
//   Completeness final → Resposta determinística → GroundingGateV3
//
// Regras que este módulo NÃO negocia:
// - `executable` executa nos motores canônicos; o ActionPlanner não escolhe tool.
// - `clarification_required` pergunta com opções REAIS do usuário e guarda o IR
//   original para retomar sem recompilar a pergunta.
// - `unsupported` devolve falha honesta; nunca cai em resposta aproximada.
// - Somente `compiler_failed` devolve autoridade ao roteador legado.
import {
  MAX_IR_QUERIES, normalizeToV2,
  type DialogueActLabel, type FinancialQueryIR, type FinancialQueryIRv2,
} from "./FinancialQueryIR.ts";
import { validateFinancialPlan, type PlanValidation } from "./FinancialPlanValidator.ts";
import { deriveSemanticStatus, type SemanticStatus } from "./SemanticStatus.ts";
import { fastPathIR } from "./SemanticRouting.ts";
import { buildEvidenceClaims, type EvidenceClaimSet } from "./EvidenceClaims.ts";
import { checkCompleteness, type CompletenessResult } from "./CompletenessGate.ts";
import { groundReply, type GroundingResult } from "./GroundingGateV3.ts";
import { buildClarification, normalizeSlot } from "./ClarificationResponse.ts";
import { semanticBlockText } from "./SemanticAnswerFormatter.ts";
import { executeSemanticPlan, type SemanticEngineRunner, type SemanticExecutionResult } from "./SemanticQueryExecutor.ts";
import { MAX_REPLANS, runSemanticInvestigation } from "./SemanticInvestigationLoop.ts";
import {
  clearPendingClarification, normalizeTopicState, pendingClarificationOf, resolvePendingSlot,
  resolveTopicForTurn, setPendingClarification, upsertTopic,
  type ConversationTopicState, type PendingClarification,
} from "./ConversationTopicState.ts";
import type { SemanticCompilerTelemetry } from "./SemanticCompiler.ts";

export type SemanticPipelineTurn = { reply: string; toolCalls: any[] };

export type SemanticCapabilityRescue = {
  tool: string;
  args: Record<string, unknown>;
  allowed_tools: string[];
  intent: string;
};

export type SemanticPipelineResult = {
  version: "nino_semantic_ir.v3";
  status: SemanticStatus;
  ir: FinancialQueryIR | null;
  ir_v2: FinancialQueryIRv2 | null;
  validation: PlanValidation | null;
  turn: SemanticPipelineTurn | null;
  deterministic_text: string | null;
  engines: string[];
  topic_state: ConversationTopicState;
  topic_id: string | null;
  rescue: SemanticCapabilityRescue | null;
  errors: string[];
  telemetry: Record<string, unknown>;
};

export type SemanticCompileFn = (args: {
  text: string;
  previous_query: string | null;
  max_queries: number;
  reason: string;
  replan?: {
    current_ir: unknown;
    execution_summary: Array<{ query_id: string; status: string; engine: string | null }>;
    missing_targets: string[];
  } | null;
}) => Promise<{ ir: FinancialQueryIR | null; telemetry: SemanticCompilerTelemetry | null } | null>;

export type SemanticPipelineDeps = {
  compile: SemanticCompileFn;
  runEngine: SemanticEngineRunner;
  /** Opções canônicas do slot — sempre do banco do usuário, nunca da LLM. */
  loadOptions: (slot: string) => Promise<string[]>;
  recordStage: (telemetry: SemanticCompilerTelemetry, stage: "semantic_compiler" | "investigation_replan") => void;
};

export type SemanticPipelineInput = {
  text: string;
  acts: DialogueActLabel[];
  constraints: { period: boolean; dimension: boolean; entity: boolean };
  period: { from: string; to: string; label?: string };
  comparison_period?: { from: string; to: string; label?: string } | null;
  previous_query?: string | null;
  topic_state: unknown;
  /** Teto de queries do turno. 1 = comportamento single-query. */
  max_queries?: number;
  /** Loop de investigação (replan) habilitado por flag. */
  investigation_enabled?: boolean;
  failure_reply: string;
};

const SLOT_FIELD: Record<string, "category" | "card" | "account"> = {
  category: "category",
  card: "card",
  account: "account",
};

/** Aplica o slot resolvido no IR guardado, sem recompilar a pergunta. */
export function applyResolvedSlot(
  ir: FinancialQueryIRv2,
  slot: string,
  value: string,
  queryId?: string | null,
): FinancialQueryIRv2 | null {
  const field = SLOT_FIELD[normalizeSlot(slot)];
  if (!field) return null;
  const queries = ir.queries.map((q) => {
    if (queryId && q.id !== queryId) return q;
    const filters = [...q.filters.filter((f) => f.field !== field), { field, op: "eq" as const, value }];
    return { ...q, filters };
  });
  return { ...ir, queries, needs_clarification: [], assumptions: [...ir.assumptions, `slot ${field}=${value}`] };
}

function toolCallsOf(execution: SemanticExecutionResult): any[] {
  return execution.outcomes.map((o, index) => ({
    step_index: index + 1,
    tool_name: o.engine ?? "semantic_unmapped",
    args: o.args,
    result: o.result,
    ok: o.status === "ok",
    duration_ms: o.duration_ms,
    error: o.error,
  }));
}

function deterministicTextOf(execution: SemanticExecutionResult): string {
  return execution.outcomes
    .filter((o) => o.status === "ok")
    .map((o) => semanticBlockText(o.engine, o.result))
    .filter((text): text is string => !!text && text.trim().length > 0)
    .join("\n\n")
    .trim();
}

export async function runSemanticTurn(
  input: SemanticPipelineInput,
  deps: SemanticPipelineDeps,
): Promise<SemanticPipelineResult> {
  const errors: string[] = [];
  const maxQueries = Math.max(1, Math.min(MAX_IR_QUERIES, input.max_queries ?? 1));
  let state = normalizeTopicState(input.topic_state);

  // ---- 1. Pending clarification tem precedência sobre tudo ----------------
  const pending = pendingClarificationOf(state);
  let resumedFromPending = false;
  let pendingIR: FinancialQueryIRv2 | null = null;
  let pendingTelemetry: Record<string, unknown> | null = null;

  if (pending) {
    const resolution = resolvePendingSlot(pending, input.text);
    if (resolution.resolved && resolution.value) {
      const applied = applyResolvedSlot(
        normalizeToV2(pending.ir as FinancialQueryIRv2),
        pending.slot,
        resolution.value,
        pending.query_id,
      );
      if (applied) {
        pendingIR = applied;
        resumedFromPending = true;
        state = clearPendingClarification(state, pending.topic_id);
        pendingTelemetry = {
          pending_clarification: { resumed: true, slot: pending.slot, value: resolution.value },
        };
      }
    } else if (isSlotAnswerAttempt(input.text)) {
      // Resposta ainda ambígua: pergunta de novo com as opções restantes.
      const question = buildClarification({ slot: pending.slot, options: resolution.candidates });
      return {
        version: "nino_semantic_ir.v3",
        status: "clarification_required",
        ir: null, ir_v2: null, validation: null,
        turn: { reply: question.reply, toolCalls: [] },
        deterministic_text: null, engines: [],
        topic_state: state, topic_id: pending.topic_id, rescue: null, errors,
        telemetry: {
          version: "nino_semantic_ir.v3",
          semantic_status: "clarification_required",
          dialogue_acts: input.acts,
          pending_clarification: { resumed: false, slot: pending.slot, options: question.options },
        },
      };
    }
  }

  // ---- 2. Topic State ------------------------------------------------------
  const resolution = resolveTopicForTurn({
    state,
    text: input.text,
    acts: input.acts,
    period: { from: input.period.from, to: input.period.to },
    entities: [],
    explicit_period_override: input.constraints.period,
    explicit_entity_override: input.constraints.entity,
  });
  state = resolution.state;
  const topic = resolution.topic;

  // ---- 3. Fast Path / Compiler --------------------------------------------
  let ir: FinancialQueryIR | null = pendingIR as unknown as FinancialQueryIR | null;
  let fast = false;
  let compilerTelemetry: SemanticCompilerTelemetry | null = null;

  if (!ir) {
    const fastIR = fastPathIR({
      text: input.text,
      acts: input.acts,
      constraints: input.constraints,
      period: input.period,
      comparison_period: input.comparison_period ?? null,
    });
    if (fastIR) {
      ir = fastIR;
      fast = true;
    } else {
      const outcome = await deps.compile({
        text: input.text,
        previous_query: input.previous_query ?? topic.original_query ?? null,
        max_queries: maxQueries,
        reason: "semantic_ir_v3",
        replan: null,
      });
      ir = outcome?.ir ?? null;
      compilerTelemetry = outcome?.telemetry ?? null;
      if (compilerTelemetry) deps.recordStage(compilerTelemetry, "semantic_compiler");
    }
  }

  let irV2 = ir ? normalizeToV2(ir, { acts: input.acts, topic_id: topic.topic_id }) : null;
  let validation = irV2 ? validateFinancialPlan(irV2) : null;
  let status = deriveSemanticStatus({ ir: irV2, validation });

  const baseTelemetry = (): Record<string, unknown> => ({
    version: "nino_semantic_ir.v3",
    semantic_status: status,
    dialogue_acts: input.acts,
    fast_path: fast,
    resumed_from_pending: resumedFromPending,
    topic: {
      topic_id: topic.topic_id,
      subject: topic.subject,
      resumed_topic_id: resolution.resumed_topic_id,
      created: resolution.created,
      inherited_period: !input.constraints.period && !resolution.created,
      topics_open: state.topics.length,
    },
    intent: irV2?.intent ?? null,
    source: ir?.source ?? null,
    query_count: irV2?.queries.length ?? 0,
    max_queries: maxQueries,
    unsupported_reason: irV2?.unsupported_reason ?? null,
    unsupported_queries: validation?.unsupported_queries ?? [],
    mapped_tools: validation?.mapped.map((m) => m.tool) ?? [],
    plan_errors: validation?.errors ?? [],
    compiler: compilerTelemetry,
    ...(pendingTelemetry ?? {}),
  });

  // ---- 4. Clarificação determinística com opções reais --------------------
  if (status === "clarification_required" && validation) {
    const slot = validation.clarification_required[0] ?? "unknown";
    const options = await deps.loadOptions(slot).catch(() => [] as string[]);
    const question = buildClarification({ slot, options });
    const pendingNext: PendingClarification = {
      topic_id: topic.topic_id,
      slot: question.slot,
      options: question.options,
      period: { from: input.period.from, to: input.period.to },
      query_id: irV2?.queries[0]?.id ?? null,
      ir: irV2,
    };
    state = setPendingClarification(
      upsertTopic(state, { ...topic, ir: irV2, status: "clarifying", updated_at: new Date().toISOString() }, true),
      pendingNext,
    );
    return {
      version: "nino_semantic_ir.v3",
      status, ir, ir_v2: irV2, validation,
      turn: { reply: question.reply, toolCalls: [] },
      deterministic_text: null, engines: [],
      topic_state: state, topic_id: topic.topic_id, rescue: null, errors,
      telemetry: {
        ...baseTelemetry(),
        clarification: { slot: question.slot, options: question.options, options_source: options.length ? "database" : "empty" },
        executed_by: "clarification",
        action_planner_used_for_tool_choice: false,
      },
    };
  }

  // ---- 5. Unsupported: falha honesta, sem fallback legado -----------------
  if (status === "unsupported") {
    state = upsertTopic(state, { ...topic, ir: irV2, status: "answered", updated_at: new Date().toISOString() }, true);
    return {
      version: "nino_semantic_ir.v3",
      status, ir, ir_v2: irV2, validation,
      turn: { reply: input.failure_reply, toolCalls: [] },
      deterministic_text: null, engines: [],
      topic_state: state, topic_id: topic.topic_id, rescue: null, errors,
      telemetry: { ...baseTelemetry(), executed_by: "honest_failure", action_planner_used_for_tool_choice: false },
    };
  }

  // ---- 6. Compiler falhou: o legado volta a mandar ------------------------
  if (status !== "executable" || !irV2 || !validation) {
    return {
      version: "nino_semantic_ir.v3",
      status, ir, ir_v2: irV2, validation,
      turn: null, deterministic_text: null, engines: [],
      topic_state: state, topic_id: topic.topic_id, rescue: null, errors,
      telemetry: { ...baseTelemetry(), executed_by: "legacy_router", action_planner_used_for_tool_choice: true },
    };
  }

  // ---- 7. Execução determinística + investigação --------------------------
  const wantsInvestigation = input.investigation_enabled !== false && irV2.intent === "investigate";
  let execution: SemanticExecutionResult;
  let claims: EvidenceClaimSet;
  let completeness: CompletenessResult;
  let replanCount = 0;
  let replanReasons: string[] = [];
  let investigationTimedOut = false;

  if (wantsInvestigation) {
    const outcome = await runSemanticInvestigation({
      question: input.text,
      ir: irV2,
      validation,
      runner: deps.runEngine,
      replan: async (request) => {
        const revised = await deps.compile({
          text: request.original_question,
          previous_query: topic.original_query ?? null,
          max_queries: Math.max(2, maxQueries),
          reason: "semantic_ir_v3_replan",
          replan: {
            current_ir: request.ir,
            execution_summary: request.execution_summary,
            missing_targets: request.missing_targets,
          },
        });
        if (revised?.telemetry) deps.recordStage(revised.telemetry, "investigation_replan");
        return revised?.ir ? normalizeToV2(revised.ir, { acts: input.acts, topic_id: topic.topic_id }) : null;
      },
    });
    execution = outcome.execution;
    claims = outcome.claims;
    completeness = outcome.completeness;
    irV2 = outcome.ir;
    validation = outcome.validation;
    replanCount = outcome.replan_count;
    replanReasons = outcome.replan_reasons;
    investigationTimedOut = outcome.timed_out;
  } else {
    execution = await executeSemanticPlan({ ir: irV2, validation, runner: deps.runEngine });
    claims = buildEvidenceClaims(irV2, execution);
    completeness = checkCompleteness({ ir: irV2, execution, claims });
  }

  // ---- 8. Resposta determinística + Grounding ----------------------------
  const deterministic = deterministicTextOf(execution);
  const grounding: GroundingResult | null = deterministic ? groundReply({ reply: deterministic, claims }) : null;
  const okToAnswer = !!deterministic
    && (completeness.complete || completeness.partial_allowed)
    && (!grounding || grounding.ok);
  if (!okToAnswer) errors.push("semantic_gate_blocked");

  const first = validation.mapped[0];
  const rescue = !okToAnswer && first
    ? {
      tool: first.tool,
      args: first.args as Record<string, unknown>,
      allowed_tools: [...new Set(validation.mapped.map((m) => m.tool))],
      intent: irV2.intent,
    }
    : null;

  state = upsertTopic(state, {
    ...topic,
    ir: irV2,
    execution_summary: { engines: execution.engines, complete: execution.complete },
    status: okToAnswer ? "answered" : "open",
    updated_at: new Date().toISOString(),
  }, true);

  return {
    version: "nino_semantic_ir.v3",
    status, ir, ir_v2: irV2, validation,
    turn: okToAnswer ? { reply: deterministic, toolCalls: toolCallsOf(execution) } : null,
    deterministic_text: deterministic || null,
    engines: execution.engines,
    topic_state: state,
    topic_id: topic.topic_id,
    rescue,
    errors,
    telemetry: {
      ...baseTelemetry(),
      execution: {
        complete: execution.complete,
        engines: execution.engines,
        failed_queries: execution.failed_queries,
        duration_ms: execution.duration_ms,
      },
      claims_count: claims.claims.length,
      completeness: {
        complete: completeness.complete,
        fulfilled: completeness.fulfilled_targets,
        missing: completeness.missing_targets.map((m) => m.id),
      },
      grounding: grounding ? { ok: grounding.ok, violations: grounding.violations } : null,
      investigation: wantsInvestigation
        ? { ran: true, replan_count: replanCount, max_replans: MAX_REPLANS, reasons: replanReasons, timed_out: investigationTimedOut }
        : { ran: false },
      executed_by: okToAnswer ? "semantic_query_executor" : (rescue ? "semantic_rescue" : "gate_blocked"),
      action_planner_used_for_tool_choice: !okToAnswer,
    },
  };
}

/** Resposta curta ("Nubank", "o azul") é tentativa de responder ao slot. */
export function isSlotAnswerAttempt(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (t.length > 40) return false;
  return t.split(/\s+/).length <= 5 && !/\?$/.test(t);
}
