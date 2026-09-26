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

function canonicalizeTurnQuery(
  query: NonNullable<CanonicalConversationTurnContract["financial_read"]>["queries"][number],
): Pick<FinancialQuery, "operation" | "group_by"> {
  // The Conversation Brain may express the same factual monthly series as
  // `sum + group_by=month` or as `trend + group_by=month`. The runtime already
  // executes both through spending_timeseries_monthly, but the structural IR
  // validator rejects sum/value with a grouping before the temporal overlay can
  // normalize it. Canonicalize that semantic equivalence HERE, at the boundary
  // between the authoritative Turn Contract and Financial IR.
  //
  // Deliberately scoped to category/merchant reads: an unscoped overall trend
  // belongs to the longitudinal engine and must not be stolen by this rule.
  const scopedMonthlyExpense = query.metric === "expense_amount"
    && ["sum", "value"].includes(String(query.operation))
    && query.group_by.length === 1
    && query.group_by[0] === "month"
    && query.filters.length > 0
    && query.filters.every((filter) => filter.field === "category" || filter.field === "merchant");

  return {
    operation: scopedMonthlyExpense ? "trend" : query.operation,
    group_by: [...query.group_by],
  };
}

export function compileFinancialReadFromTurn(args: {
  turn: CanonicalConversationTurnContract;
  period: CanonicalPeriod;
  comparison_period?: CanonicalPeriod | null;
}): SemanticCompileOutcome | null {
  if (args.turn.domain !== "financial_read" || args.turn.mode !== "read") return null;
  const semantic = args.turn.financial_read;
  if (!semantic?.queries?.length) return null;

  const queries: FinancialQuery[] = semantic.queries.map((query, index) => {
    const canonical = canonicalizeTurnQuery(query);
    return {
      id: `q${index + 1}`,
      metric: query.metric,
      operation: canonical.operation,
      group_by: canonical.group_by,
      filters: query.filters.map((filter) => ({ ...filter, op: "eq" as const })),
      limit: query.limit,
      comparison_direction: query.comparison_direction ?? "any",
      comparison_baseline: query.comparison_baseline ?? "period",
      comparison_baseline_window: query.comparison_baseline_window ?? null,
    };
  });

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
