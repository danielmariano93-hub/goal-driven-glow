// ExecutionTrace (`nino_adaptive.v1`)
//
// Um objeto por turno que responde "por que este turno demorou 12 segundos?".
// Guarda a decisão do roteador, as escaladas, os blocos de contexto carregados
// e omitidos, os grupos paralelos de ferramenta, o caminho crítico e os marcos
// de tempo separados (backend, fila, provedor, percebido).
import type { ContextBlock } from "./ContextSelector.ts";
import type { EscalationGate, ExecutionPlan, ExecutionTier, ModelTier } from "./AdaptiveExecutionRouter.ts";
import type { TurnSignals } from "./TurnComplexityClassifier.ts";

export type TopicResolutionSource =
  | "quoted_message" | "pending_expectation" | "explicit_reference"
  | "semantic_match" | "active_topic" | "recent_history" | "new_topic" | "clarification";

export type ExecutionTraceData = {
  execution_tier: ExecutionTier | null;
  complexity_score: number | null;
  ambiguity_score: number | null;
  risk_score: number | null;
  context_dependency_score: number | null;
  selected_model: string | null;
  model_tier: ModelTier | null;
  selection_reason: string | null;
  context_blocks_loaded: ContextBlock[];
  context_blocks_skipped: ContextBlock[];
  tools_planned: string[];
  tools_executed: string[];
  parallel_groups: string[][];
  critical_path_ms: number | null;
  escalation_count: number;
  escalation_reasons: EscalationGate[];
  early_exit_stage: string | null;
  topic_candidates: Array<{ topic_id: string; score: number }>;
  selected_topic_id: string | null;
  topic_match_score: number | null;
  topic_resolution_source: TopicResolutionSource | null;
  quoted_message_used: boolean;
  marks: Record<string, string>;
};

export type ExecutionTrace = {
  data: ExecutionTraceData;
  signals(signals: TurnSignals): void;
  plan(plan: ExecutionPlan): void;
  context(loaded: ContextBlock[], skipped: ContextBlock[]): void;
  model(name: string | null, tier: ModelTier | null): void;
  tool(name: string, executed: boolean): void;
  parallelGroup(names: string[]): void;
  criticalPath(ms: number): void;
  earlyExit(stage: string): void;
  topic(args: {
    source: TopicResolutionSource;
    topic_id: string | null;
    score: number | null;
    candidates?: Array<{ topic_id: string; score: number }>;
    quoted_used?: boolean;
  }): void;
  mark(name: string, at?: Date): void;
  /** Colunas de telemetria para `agent_runs` (aditivas, best-effort). */
  toRunColumns(): Record<string, unknown>;
};

export function createExecutionTrace(): ExecutionTrace {
  const data: ExecutionTraceData = {
    execution_tier: null,
    complexity_score: null, ambiguity_score: null, risk_score: null,
    context_dependency_score: null,
    selected_model: null, model_tier: null, selection_reason: null,
    context_blocks_loaded: [], context_blocks_skipped: [],
    tools_planned: [], tools_executed: [], parallel_groups: [],
    critical_path_ms: null,
    escalation_count: 0, escalation_reasons: [], early_exit_stage: null,
    topic_candidates: [], selected_topic_id: null, topic_match_score: null,
    topic_resolution_source: null, quoted_message_used: false,
    marks: {},
  };

  return {
    data,
    signals(s) {
      data.complexity_score = s.complexity_score;
      data.ambiguity_score = s.ambiguity_score;
      data.risk_score = s.risk_score;
      data.context_dependency_score = s.context_dependency_score;
    },
    plan(p) {
      data.execution_tier = p.tier;
      data.model_tier = p.model_tier;
      data.selection_reason = p.selection_reason;
      data.escalation_count = p.escalations.length;
      data.escalation_reasons = p.escalations.map((e) => e.gate);
    },
    context(loaded, skipped) {
      data.context_blocks_loaded = loaded;
      data.context_blocks_skipped = skipped;
    },
    model(name, tier) {
      data.selected_model = name;
      if (tier) data.model_tier = tier;
    },
    tool(name, executed) {
      if (!data.tools_planned.includes(name)) data.tools_planned.push(name);
      if (executed && !data.tools_executed.includes(name)) data.tools_executed.push(name);
    },
    parallelGroup(names) {
      if (names.length > 1) data.parallel_groups.push([...names]);
    },
    criticalPath(ms) { data.critical_path_ms = Math.max(0, Math.round(ms)); },
    earlyExit(stage) { data.early_exit_stage = stage; },
    topic(args) {
      data.topic_resolution_source = args.source;
      data.selected_topic_id = args.topic_id;
      data.topic_match_score = args.score;
      if (args.candidates) data.topic_candidates = args.candidates;
      if (args.quoted_used) data.quoted_message_used = true;
    },
    mark(name, at = new Date()) { data.marks[name] = at.toISOString(); },
    toRunColumns() {
      return {
        execution_tier: data.execution_tier,
        complexity_score: data.complexity_score,
        ambiguity_score: data.ambiguity_score,
        risk_score: data.risk_score,
        context_dependency_score: data.context_dependency_score,
        context_blocks_loaded: data.context_blocks_loaded,
        context_blocks_skipped: data.context_blocks_skipped,
        escalation_count: data.escalation_count,
        escalation_reason: data.escalation_reasons.join(",") || null,
        early_exit_stage: data.early_exit_stage,
        parallel_groups: data.parallel_groups,
        critical_path_ms: data.critical_path_ms,
        topic_id: data.selected_topic_id,
        topic_match_score: data.topic_match_score,
        topic_resolution_source: data.topic_resolution_source,
        quoted_message_used: data.quoted_message_used,
        turn_marks: data.marks,
      };
    },
  };
}

/**
 * Latências derivadas dos marcos. `agent_runs.latency_ms` NUNCA é ponta a ponta:
 * backend é o trabalho do agente; fila e provedor são transporte.
 */
export function latencyBreakdown(marks: Record<string, string>): {
  backend_latency_ms: number | null;
  queue_latency_ms: number | null;
  provider_latency_ms: number | null;
  ack_latency_ms: number | null;
  perceived_latency_ms: number | null;
} {
  const at = (k: string): number | null => {
    const v = marks[k];
    const n = v ? Date.parse(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const diff = (a: string, b: string): number | null => {
    const x = at(a), y = at(b);
    return x !== null && y !== null ? Math.max(0, y - x) : null;
  };
  return {
    backend_latency_ms: diff("agent_started_at", "agent_completed_at"),
    queue_latency_ms: diff("outbound_queued_at", "provider_sent_at"),
    provider_latency_ms: diff("provider_sent_at", "provider_ack_at"),
    ack_latency_ms: diff("provider_ack_at", "provider_ack_at") === null ? null : 0,
    perceived_latency_ms: diff("inbound_received_at", "provider_ack_at")
      ?? diff("inbound_received_at", "agent_completed_at"),
  };
}
