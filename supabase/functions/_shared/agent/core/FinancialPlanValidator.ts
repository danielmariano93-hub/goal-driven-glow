// FinancialPlanValidator (`nino_semantic_ir.v3`)
//
// Validação DETERMINÍSTICA do plano financeiro — sem LLM-as-judge. Um IR só
// ganha autoridade de execução depois de passar aqui: estrutura válida,
// dependências sãs, e cada query obrigatória com motor canônico mapeado.
import { validateFinancialIRv2, type FinancialQueryIRv2 } from "./FinancialQueryIR.ts";
import { mappingForQuery } from "./IRCapabilityAdapter.ts";

export type PlanValidation = {
  ok: boolean;
  errors: string[];
  unsupported_queries: string[];
  clarification_required: string[];
  mapped: Array<{ query_id: string; tool: string; args: Record<string, unknown> }>;
};

export function validateFinancialPlan(ir: FinancialQueryIRv2 | null): PlanValidation {
  if (!ir) {
    return { ok: false, errors: ["ir_missing"], unsupported_queries: [], clarification_required: [], mapped: [] };
  }
  const errors = validateFinancialIRv2(ir);
  const clarification = [...new Set((ir.needs_clarification ?? []).map(String).filter(Boolean))];
  if (ir.intent === "unsupported") {
    return {
      ok: false,
      errors: errors.length ? errors : ["intent_unsupported"],
      unsupported_queries: ir.queries.map((q) => q.id),
      clarification_required: clarification,
      mapped: [],
    };
  }
  if (errors.length) {
    return {
      ok: false,
      errors,
      unsupported_queries: ir.queries.map((q) => q.id),
      clarification_required: clarification,
      mapped: [],
    };
  }

  const mapped: PlanValidation["mapped"] = [];
  const unsupported: string[] = [];
  for (const q of ir.queries) {
    const mapping = mappingForQuery(q, ir);
    if (!mapping) { unsupported.push(q.id); continue; }
    mapped.push({ query_id: q.id, tool: mapping.tool, args: mapping.args });
  }

  // Clarificação pendente bloqueia o turno inteiro: perguntar é mais honesto do
  // que executar o slot errado.
  if (clarification.length) {
    return { ok: false, errors: [], unsupported_queries: unsupported, clarification_required: clarification, mapped };
  }
  // Query obrigatória sem motor mapeado impede o turno inteiro. Nunca responder
  // metade da pergunta como se fosse a resposta completa.
  const requiredIds = new Set(
    (ir.completeness_targets ?? []).filter((t) => t.required !== false).map((t) => t.query_id),
  );
  const blocking = unsupported.filter((id) => requiredIds.size === 0 || requiredIds.has(id));
  return {
    ok: blocking.length === 0 && mapped.length > 0,
    errors: blocking.length ? blocking.map((id) => `unsupported_required_query:${id}`) : [],
    unsupported_queries: unsupported,
    clarification_required: [],
    mapped,
  };
}
