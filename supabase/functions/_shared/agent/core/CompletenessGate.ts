// CompletenessGate (`nino_semantic_ir.v3`)
//
// Gate #2 do caminho semântico: TEMOS EVIDÊNCIA SUFICIENTE para responder tudo
// que foi pedido? Nunca responder A+B como completo tendo só A.
// (O Grounding, depois, verifica se a resposta respeitou essa evidência.)
import type { CompletenessTarget, FinancialQueryIRv2 } from "./FinancialQueryIR.ts";
import type { EvidenceClaimSet } from "./EvidenceClaims.ts";
import type { SemanticExecutionResult } from "./SemanticQueryExecutor.ts";

export type CompletenessResult = {
  version: "nino_completeness.v1";
  complete: boolean;
  fulfilled_targets: string[];
  missing_targets: Array<{ id: string; query_id: string; claim: string; reason: string }>;
  failed_queries: string[];
  partial_allowed: boolean;
};

/** Alguns alvos são derivados deterministicamente de outra evidência já obtida. */
function derivable(target: CompletenessTarget, claims: EvidenceClaimSet): boolean {
  if (target.claim === "money") {
    return claims.claims.some((c) => c.query_id === target.query_id && c.type === "rank" && c.value != null);
  }
  if (target.claim === "rank") {
    return claims.claims.filter((c) => c.query_id === target.query_id && c.type === "entity").length > 1;
  }
  if (target.claim === "percentage") {
    const money = claims.claims.filter((c) => c.query_id === target.query_id && c.type === "money");
    const rows = claims.claims.filter((c) => c.query_id === target.query_id && c.type === "rank");
    return money.length > 0 && rows.length > 0;
  }
  return false;
}

export function checkCompleteness(args: {
  ir: FinancialQueryIRv2;
  execution: SemanticExecutionResult;
  claims: EvidenceClaimSet;
}): CompletenessResult {
  const { ir, execution, claims } = args;
  const fulfilled: string[] = [];
  const missing: CompletenessResult["missing_targets"] = [];

  const targets = ir.completeness_targets.length
    ? ir.completeness_targets
    : ir.queries.map((q) => ({ id: `${q.id}.result`, query_id: q.id, claim: "money" as const, required: true }));

  for (const target of targets) {
    const outcome = execution.outcomes.find((o) => o.query_id === target.query_id);
    if (!outcome || outcome.status !== "ok") {
      missing.push({
        id: target.id, query_id: target.query_id, claim: target.claim,
        reason: !outcome ? "query_not_executed" : `query_${outcome.status}`,
      });
      continue;
    }
    const direct = claims.claims.some((c) => c.query_id === target.query_id && c.type === target.claim);
    // Ausência é evidência válida: "não houve gasto nesse recorte" responde.
    const absence = claims.claims.some((c) => c.query_id === target.query_id && c.type === "absence");
    if (direct || absence || derivable(target, claims)) fulfilled.push(target.id);
    else {
      missing.push({
        id: target.id, query_id: target.query_id, claim: target.claim,
        reason: "claim_not_available",
      });
    }
  }

  const requiredMissing = missing.filter((m) =>
    targets.find((t) => t.id === m.id)?.required !== false
  );
  return {
    version: "nino_completeness.v1",
    complete: requiredMissing.length === 0 && execution.failed_queries.length === 0,
    fulfilled_targets: fulfilled,
    missing_targets: missing,
    failed_queries: execution.failed_queries,
    partial_allowed: fulfilled.length > 0,
  };
}
