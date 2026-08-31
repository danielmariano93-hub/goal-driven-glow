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
    reason: string;
    reply: string;
    plan: AnalyticalPlan;
    toolCalls: any[];
  };

export const COMPOSITE_FAILURE_REPLY =
  "Não consegui cruzar suas metas com o histórico agora. Não vou te mandar um número que eu não confirmei. Me chame de novo em alguns minutos que eu refaço essa leitura.";

/** Telemetria determinística do caminho analítico. */
export type CompositeTelemetry = {
  composite_plan_matched: boolean;
  goal_performance_tool_started: boolean;
  goal_performance_tool_failed: boolean;
  fallback_reason: string | null;
  final_path: "not_applicable" | "composite_answered" | "composite_failed";
};

export async function runCompositeAnalysis(
  sb: SupabaseClient,
  input: {
    user_id: string;
    conversation_id: string;
    text: string;
    previous_scope?: AnalysisScope | null;
    turn_period?: { from: string; to: string; label?: string } | null;
    now?: Date;
    onTelemetry?: (t: CompositeTelemetry) => void;
  },
): Promise<CompositeAnalysisOutcome> {
  const emit = (t: CompositeTelemetry) => { try { input.onTelemetry?.(t); } catch { /* noop */ } };

  const plan = resolveAnalyticalPlan({
    text: input.text,
    now: input.now,
    previous_scope: input.previous_scope ?? null,
    turn_period: input.turn_period ?? null,
  });
  const engine = plan?.engines?.[0] ?? null;
  if (!plan || !engine) {
    emit({
      composite_plan_matched: false, goal_performance_tool_started: false,
      goal_performance_tool_failed: false, fallback_reason: "plan_not_matched",
      final_path: "not_applicable",
    });
    return { status: "not_applicable" };
  }

  const fail = (reason: string, toolCalls: any[]): CompositeAnalysisOutcome => {
    console.warn("[composite_analysis] failed", reason);
    emit({
      composite_plan_matched: true, goal_performance_tool_started: true,
      goal_performance_tool_failed: true, fallback_reason: reason,
      final_path: "composite_failed",
    });
    return { status: "failed", reason, reply: COMPOSITE_FAILURE_REPLY, plan, toolCalls };
  };

  const ctx = {
    sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: input.text,
  } as any;

  // Recuperação determinística: uma retentativa real do motor obrigatório.
  let exec = await runTool(ctx, engine.tool, engine.args, { timeoutMs: 15_000 });
  if (!exec?.ok || !exec.result) {
    exec = await runTool(ctx, engine.tool, engine.args, { timeoutMs: 15_000, maxRetries: 0 });
  }
  if (!exec?.ok || !exec.result) {
    return fail("engine_error:" + String(exec?.error ?? "unknown").slice(0, 120), exec ? [exec] : []);
  }

  const assessment = exec.result as any;
  const categories: any[] = Array.isArray(assessment?.categories) ? assessment.categories : [];
  if (!categories.length) return fail("engine_empty_scope", [exec]);

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
  });
  if (!gatesPassed(gates)) {
    // Regra dura: não respondemos análise que viola contrato de escopo ou
    // separação meta/tendência — e também não deixamos o fluxo antigo
    // responder outra coisa no lugar.
    return fail("gates_failed:" + failedGates(gates).map((g) => `${g.gate}(${g.detail ?? "sem detalhe"})`).join(","), [exec]);
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
    goal_performance_tool_failed: false, fallback_reason: null,
    final_path: "composite_answered",
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

