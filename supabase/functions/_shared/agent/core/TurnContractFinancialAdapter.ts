// TurnContractFinancialAdapter (`nino_turn_to_financial.v1`)
//
// Deterministic domain adapter: the Conversation Brain already resolved the
// financial semantics in Turn Contract v2. This module only adds canonical
// periods/query ids/completeness targets required by the existing financial
// runtime. It does NOT inspect the original user's wording.

import type { CanonicalConversationTurnContract } from "./ConversationTurnContract.ts";
import type {
  CanonicalPeriod,
  FinancialQuery,
  FinancialQueryIR,
} from "./FinancialQueryIR.ts";
import type { SemanticCompileOutcome } from "./SemanticCompiler.ts";

function targetFor(q: FinancialQuery): string {
  if (q.operation === "rank" || q.operation === "breakdown") return `${q.id}.rank`;
  if (q.operation === "compare" || q.operation === "explain" || q.operation === "trend") return `${q.id}.direction`;
  return `${q.id}.money`;
}

export function compileFinancialReadFromTurn(args: {
  turn: CanonicalConversationTurnContract;
  period: CanonicalPeriod;
  comparison_period?: CanonicalPeriod | null;
}): SemanticCompileOutcome | null {
  if (args.turn.domain !== "financial_read" || args.turn.mode !== "read") return null;
  const semantic = args.turn.financial_read;
  if (!semantic?.queries?.length) return null;

  const queries: FinancialQuery[] = semantic.queries.map((query, index) => ({
    id: `q${index + 1}`,
    metric: query.metric,
    operation: query.operation,
    group_by: [...query.group_by],
    filters: query.filters.map((filter) => ({ ...filter, op: "eq" as const })),
    limit: query.limit,
    comparison_direction: query.comparison_direction ?? "any",
  }));

  const ir: FinancialQueryIR = {
    version: "financial_query_ir.v1",
    intent: semantic.intent,
    needs_clarification: [],
    assumptions: ["semântica herdada de conversation_turn_contract.v2"],
    queries,
    completeness_targets: queries.map(targetFor),
    period: args.period,
    comparison_period: args.comparison_period ?? null,
    source: "semantic_compiler",
    unsupported_reason: null,
  };

  return {
    ir,
    telemetry: {
      model: "deterministic:turn_contract",
      llm_calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: 0,
      ok: true,
      error: null,
      source: "fast_path",
    },
  };
}
