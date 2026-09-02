// SemanticStatus (`nino_semantic_ir.v3`)
//
// Estado explícito do caminho semântico do turno. Antes o Core "adaptava e
// seguia": IR pedindo clarificação virava execução aproximada, IR unsupported
// caía silenciosamente na rota legada (fail-open). Agora o status é derivado uma
// única vez e SÓ `compiler_failed` devolve autoridade ao roteador legado.
import type { PlanValidation } from "./FinancialPlanValidator.ts";
import type { FinancialQueryIRv2 } from "./FinancialQueryIR.ts";

export type SemanticStatus =
  | "executable"
  | "clarification_required"
  | "unsupported"
  | "compiler_failed";

export function deriveSemanticStatus(args: {
  ir: FinancialQueryIRv2 | null;
  validation: PlanValidation | null;
}): SemanticStatus {
  const { ir, validation } = args;
  // Sem IR = o compilador não entregou nada utilizável. Só aqui o legado manda.
  if (!ir) return "compiler_failed";
  if (ir.intent === "unsupported") return "unsupported";
  if (!validation) return "compiler_failed";
  if (validation.clarification_required.length > 0) return "clarification_required";
  if (!validation.ok) return "unsupported";
  return "executable";
}

/** O roteador legado só pode sobrescrever a decisão em `compiler_failed`. */
export function legacyMayOverride(status: SemanticStatus): boolean {
  return status === "compiler_failed";
}

/** A execução determinística semântica só roda com IR validado. */
export function semanticHasExecutionAuthority(status: SemanticStatus): boolean {
  return status === "executable";
}
