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

export async function runCompositeAnalysis(
  sb: SupabaseClient,
  input: {
    user_id: string;
    conversation_id: string;
    text: string;
    previous_scope?: AnalysisScope | null;
    turn_period?: { from: string; to: string; label?: string } | null;
    now?: Date;
  },
): Promise<CompositeAnalysisResult | null> {
  const plan = resolveAnalyticalPlan({
    text: input.text,
    now: input.now,
    previous_scope: input.previous_scope ?? null,
    turn_period: input.turn_period ?? null,
  });
  if (!plan) return null;

  const engine = plan.engines[0];
  if (!engine) return null;

  const exec = await runTool(sb, {
    user_id: input.user_id,
    conversation_id: input.conversation_id,
    user_text: input.text,
    name: engine.tool,
    args: engine.args,
  } as any);

  if (!exec?.ok || !exec.result) return null;
  const assessment = exec.result;
  const categories: any[] = Array.isArray(assessment?.categories) ? assessment.categories : [];
  if (!categories.length) return null;

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
  });
  if (!gatesPassed(gates)) {
    // Regra dura: não respondemos análise que viola contrato de escopo ou
    // separação meta/tendência. Devolvemos null para o fluxo padrão assumir.
    console.warn("[composite_analysis] gates_failed", failedGates(gates).map((g) => g.gate).join(","));
    return null;
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

  return {
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
