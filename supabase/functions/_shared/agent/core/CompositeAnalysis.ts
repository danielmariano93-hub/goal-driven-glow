// CompositeAnalysis (`nino_composite.v1`) — orquestra a análise composta.
//
// Fluxo: plano → motor canônico → interpretação determinística → truth gates →
// completude → resposta humana com conclusão primeiro. Se qualquer etapa falha,
// devolve `null` e o fluxo atual do agente segue intacto (fallback isolado).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { resolveAnalyticalPlan, type AnalyticalPlan } from "./AnalyticalQueryPlanner.ts";
import { bindEntities, type AnalysisScope } from "./ScopeResolver.ts";
import { resolveInterpretation, type InterpretationSummary } from "./InterpretationResolver.ts";
import { runAnalysisGates, gatesPassed, failedGates, type GateResult } from "./AnalysisGates.ts";
import {
  checkCompleteness, evaluateRequirements, stripUnwantedContinuation,
  type CompletenessReport,
} from "./AnswerCompleteness.ts";
import { buildEvidenceGraph, type EvidenceGraphPayload } from "./EvidenceGraph.ts";
import { formatGoalPerformance } from "./DeterministicAnswers.ts";
import { runTool } from "./ToolRuntime.ts";
import {
  allowedEnginesFor, isForbiddenSubstitute, PROTECTED_ENGINE_FAILURE_REPLY,
} from "./ProtectedAnalyticalRouting.ts";
import { ANALYTICAL_CONTRACT_VERSION, AGENT_RUNTIME_VERSION } from "./RuntimeContract.ts";

export type CompositeAnalysisResult = {
  reply: string;
  plan: AnalyticalPlan;
  scope: AnalysisScope;
  interpretation: InterpretationSummary;
  completeness: CompletenessReport;
  gates: GateResult[];
  evidence_graph: EvidenceGraphPayload;
  assessment: any;
  toolCalls: any[];
};

/**
 * Desfecho do caminho analítico (`nino_composite.v1`).
 *
 * `not_applicable` — o planner não reconheceu pergunta composta: fluxo padrão.
 * `answered`       — motor canônico respondeu com evidência completa.
 * `failed`         — o plano FOI reconhecido e o motor obrigatório falhou.
 *                    Nesse caso é PROIBIDO deixar o fluxo antigo responder
 *                    uma análise semanticamente diferente: o Nino avisa
 *                    honestamente que não conseguiu cruzar os dados agora.
 */
export type CompositeAnalysisOutcome =
  | { status: "not_applicable" }
  | ({ status: "answered" } & CompositeAnalysisResult)
  | {
    status: "failed";
    failure_type: "engine_failed" | "truth_gate_blocked" | "empty_scope" | "engine_not_allowed";
    reason: string;
    reply: string;
    plan: AnalyticalPlan;
    toolCalls: any[];
    assessment?: any;
    gates?: GateResult[];
  };

export const COMPOSITE_FAILURE_REPLY =
  "Bloqueei esta leitura porque os períodos das metas e do histórico não ficaram compatíveis. Não vou te mandar um número sem confirmar a mesma janela.";

/** Telemetria determinística do caminho analítico. */
export type CompositeTelemetry = {
  composite_plan_matched: boolean;
  goal_performance_tool_started: boolean;
  goal_performance_tool_failed: boolean;
  truth_gate_blocked: boolean;
  fallback_reason: string | null;
  final_path: "not_applicable" | "composite_answered" | "composite_failed";
  protected_route: boolean;
  runtime_version: string;
  analytical_contract_version: string;
  planned_tool: string | null;
  planned_entity_ids: string[];
  planned_current_period: { from: string; to: string } | null;
  planned_comparison_period: { from: string; to: string } | null;
};

export async function runCompositeAnalysis(
  sb: SupabaseClient,
  input: {
    user_id: string;
    conversation_id: string;
    text: string;
    previous_scope?: AnalysisScope | null;
    turn_period?: { from: string; to: string; label?: string } | null;
    period_roles?: import("../../analytics/periodResolver.ts").PeriodRoleContract | null;
    now?: Date;
    onTelemetry?: (t: CompositeTelemetry) => void;
  },
): Promise<CompositeAnalysisOutcome> {
  const stamp = {
    runtime_version: AGENT_RUNTIME_VERSION,
    analytical_contract_version: ANALYTICAL_CONTRACT_VERSION,
  };
  const emit = (t: Omit<CompositeTelemetry, keyof typeof stamp>) => {
    try { input.onTelemetry?.({ ...t, ...stamp } as CompositeTelemetry); } catch { /* noop */ }
  };

  const plan = resolveAnalyticalPlan({
    text: input.text,
    now: input.now,
    previous_scope: input.previous_scope ?? null,
    turn_period: input.turn_period ?? null,
    period_roles: input.period_roles ?? null,
  });
  const engine = plan?.engines?.[0] ?? null;
  if (!plan || !engine) {
    emit({
      composite_plan_matched: false, goal_performance_tool_started: false,
      goal_performance_tool_failed: false, truth_gate_blocked: false, fallback_reason: "plan_not_matched",
      final_path: "not_applicable",
      protected_route: false, planned_tool: null, planned_entity_ids: [],
      planned_current_period: null, planned_comparison_period: null,
    });
    return { status: "not_applicable" };
  }

  const planned = {
    protected_route: Boolean(plan.protected_route),
    planned_tool: engine.tool,
    planned_entity_ids: [...(plan.expected_entity_ids ?? [])],
    planned_current_period: { from: plan.periods.current.from, to: plan.periods.current.to },
    planned_comparison_period: plan.periods.comparison
      ? { from: plan.periods.comparison.from, to: plan.periods.comparison.to }
      : null,
  };

  const fail = (
    failure_type: "engine_failed" | "truth_gate_blocked" | "empty_scope" | "engine_not_allowed",
    reason: string,
    toolCalls: any[],
    assessment?: any,
    gates?: GateResult[],
  ): CompositeAnalysisOutcome => {
    console.warn("[composite_analysis] failed", reason);
    emit({
      composite_plan_matched: true, goal_performance_tool_started: true,
      goal_performance_tool_failed: failure_type === "engine_failed",
      truth_gate_blocked: failure_type === "truth_gate_blocked",
      fallback_reason: reason,
      final_path: "composite_failed",
      ...planned,
    });
    const reply = plan.protected_route ? PROTECTED_ENGINE_FAILURE_REPLY : COMPOSITE_FAILURE_REPLY;
    return { status: "failed", failure_type, reason, reply, plan, toolCalls, assessment, gates };
  };

  // Allowlist estrita: para `goal_performance_analysis` só existe UMA
  // ferramenta legítima. Nada de substituto agregado escolhido por LLM.
  if (isForbiddenSubstitute(plan.primary_intent, engine.tool)) {
    return fail(
      "engine_not_allowed",
      `engine_not_allowed:${engine.tool}|allowed=${allowedEnginesFor(plan.primary_intent).join("|")}`,
      [],
    );
  }

  const ctx = {
    sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: input.text,
  } as any;

  // Recuperação determinística: uma retentativa real do motor obrigatório.
  let exec = await runTool(ctx, engine.tool, engine.args, { timeoutMs: 15_000 });
  if (!exec?.ok || !exec.result) {
    exec = await runTool(ctx, engine.tool, engine.args, { timeoutMs: 15_000, maxRetries: 0 });
  }
  if (!exec?.ok || !exec.result) {
    return fail("engine_failed", "engine_error:" + String(exec?.error ?? "unknown").slice(0, 120), exec ? [exec] : []);
  }

  const assessment = exec.result as any;
  const categories: any[] = Array.isArray(assessment?.categories) ? assessment.categories : [];
  if (!categories.length) return fail("empty_scope", "engine_empty_scope", [exec], assessment);

  const scope = bindEntities(
    plan.scope,
    categories.map((c) => ({ id: String(c.category_id), label: String(c.category_name) })),
  );

  const comparisonRequested = Boolean(plan.periods.comparison);
  const gates = runAnalysisGates({
    assessment,
    scope,
    requirements: plan.requirements,
    comparison_requested: comparisonRequested,
    expected_entity_count: categories.length,
    expected_current_period: plan.periods.current,
    expected_comparison_period: plan.periods.comparison,
    expected_comparison_basis: plan.periods.comparison_basis,
    expected_entity_ids: plan.expected_entity_ids ?? null,
  });
  if (!gatesPassed(gates)) {
    // Regra dura: não respondemos análise que viola contrato de escopo ou
    // separação meta/tendência — e também não deixamos o fluxo antigo
    // responder outra coisa no lugar.
    return fail("truth_gate_blocked", "gates_failed:" + failedGates(gates).map((g) => `${g.gate}(${g.detail ?? "sem detalhe"})`).join(","), [exec], assessment, gates);
  }

  const interpretation = resolveInterpretation(assessment);
  const requirements = evaluateRequirements(plan.requirements, assessment, {
    comparison_requested: comparisonRequested,
  });
  const completeness = checkCompleteness(requirements);

  const rendered = formatGoalPerformance(assessment, interpretation, {
    comparison_requested: comparisonRequested,
    disclosure: completeness.disclosure,
  });
  const reply = stripUnwantedContinuation(rendered, {
    entitiesFullyCovered: completeness.status === "complete",
  });

  emit({
    composite_plan_matched: true, goal_performance_tool_started: true,
    goal_performance_tool_failed: false, truth_gate_blocked: false, fallback_reason: null,
    final_path: "composite_answered",
    ...planned,
  });

  return {
    status: "answered",
    reply,
    plan: { ...plan, requirements },
    scope,
    interpretation,
    completeness,
    gates,
    evidence_graph: buildEvidenceGraph(assessment),
    assessment,
    toolCalls: [exec],
  };
}

