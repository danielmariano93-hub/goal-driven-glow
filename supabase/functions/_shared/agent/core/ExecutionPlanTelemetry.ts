// ExecutionPlanTelemetry (`nino_coverage_telemetry.v1`)
// Resumo auditável do plano que o turno tentou executar, gravado em
// `agent_runs.context_layers.semantic_execution.plan`. Serve à medição de
// cobertura: cada turno passa a dizer QUAL combinação foi pedida e se ela tinha
// motor, sem reproduzir a conversa. Só nomes de campos: nenhum valor de filtro
// (estabelecimento, categoria) é gravado.
import type { FinancialQueryIRv2 } from "./FinancialQueryIR.ts";
import { ontologySignature } from "./IRCapabilityAdapter.ts";

export const EXECUTION_PLAN_TELEMETRY_VERSION = "nino_coverage_telemetry.v1";

export type ExecutionPlanTelemetry = {
  version: typeof EXECUTION_PLAN_TELEMETRY_VERSION;
  intent: string;
  queries: Array<{
    id: string;
    signature: string;
    filter_count: number;
    limit: number | null;
    has_own_period: boolean;
  }>;
  has_comparison_period: boolean;
  needs_clarification: number;
};

export function executionPlanTelemetry(
  ir: Pick<FinancialQueryIRv2, "intent" | "queries" | "comparison_period" | "needs_clarification"> | null | undefined,
): ExecutionPlanTelemetry | null {
  if (!ir) return null;
  return {
    version: EXECUTION_PLAN_TELEMETRY_VERSION,
    intent: String(ir.intent ?? "unknown"),
    queries: (ir.queries ?? []).slice(0, 6).map((q) => ({
      id: String(q.id),
      signature: ontologySignature(q),
      filter_count: q.filters.length,
      limit: q.limit ?? null,
      has_own_period: !!q.period,
    })),
    has_comparison_period: !!ir.comparison_period,
    needs_clarification: ir.needs_clarification?.length ?? 0,
  };
}
