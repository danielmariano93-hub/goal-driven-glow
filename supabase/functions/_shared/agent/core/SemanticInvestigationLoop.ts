// SemanticInvestigationLoop (`nino_semantic_ir.v3`)
//
// plan → execute → observe → replan, com teto duro. O replan recebe pergunta
// original, IR atual, resumo da execução e alvos faltantes e SÓ pode emitir um
// IR revisado: nunca escolhe tool, nunca escreve resposta. Todo IR revisado
// passa de novo pelo FinancialPlanValidator.
import type { FinancialQueryIRv2 } from "./FinancialQueryIR.ts";
import { validateFinancialPlan, type PlanValidation } from "./FinancialPlanValidator.ts";
import { executeSemanticPlan, type SemanticEngineRunner, type SemanticExecutionResult } from "./SemanticQueryExecutor.ts";
import { buildEvidenceClaims, type EvidenceClaimSet } from "./EvidenceClaims.ts";
import { checkCompleteness, type CompletenessResult } from "./CompletenessGate.ts";

export const MAX_REPLANS = 2;

export type ReplanRequest = {
  original_question: string;
  ir: FinancialQueryIRv2;
  execution_summary: Array<{ query_id: string; status: string; engine: string | null }>;
  missing_targets: string[];
};

export type Replanner = (request: ReplanRequest) => Promise<FinancialQueryIRv2 | null>;

export type InvestigationResult = {
  version: "nino_investigation.v1";
  ir: FinancialQueryIRv2;
  validation: PlanValidation;
  execution: SemanticExecutionResult;
  claims: EvidenceClaimSet;
  completeness: CompletenessResult;
  replan_count: number;
  replan_reasons: string[];
  timed_out: boolean;
};

export async function runSemanticInvestigation(args: {
  question: string;
  ir: FinancialQueryIRv2;
  validation: PlanValidation;
  runner: SemanticEngineRunner;
  replan?: Replanner | null;
  timeoutMs?: number;
}): Promise<InvestigationResult> {
  const deadline = Date.now() + Math.max(1_000, args.timeoutMs ?? 20_000);
  let ir = args.ir;
  let validation = args.validation;
  let replanCount = 0;
  const reasons: string[] = [];
  let timedOut = false;

  let execution = await executeSemanticPlan({ ir, validation, runner: args.runner });
  let claims = buildEvidenceClaims(ir, execution);
  let completeness = checkCompleteness({ ir, execution, claims });

  while (!completeness.complete && args.replan && replanCount < MAX_REPLANS) {
    if (Date.now() > deadline) { timedOut = true; reasons.push("investigation_timeout"); break; }
    const revised = await args.replan({
      original_question: args.question,
      ir,
      execution_summary: execution.outcomes.map((o) => ({ query_id: o.query_id, status: o.status, engine: o.engine })),
      missing_targets: completeness.missing_targets.map((m) => m.id),
    });
    if (!revised) { reasons.push("replan_declined"); break; }
    const revisedValidation = validateFinancialPlan(revised);
    if (!revisedValidation.ok) { reasons.push(`replan_invalid:${revisedValidation.errors.join(",")}`); break; }
    replanCount++;
    reasons.push("replan_applied");
    ir = revised;
    validation = revisedValidation;
    execution = await executeSemanticPlan({ ir, validation, runner: args.runner });
    claims = buildEvidenceClaims(ir, execution);
    completeness = checkCompleteness({ ir, execution, claims });
  }

  return {
    version: "nino_investigation.v1",
    ir, validation, execution, claims, completeness,
    replan_count: replanCount,
    replan_reasons: reasons,
    timed_out: timedOut,
  };
}
