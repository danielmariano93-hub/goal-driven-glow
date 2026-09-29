// FinancialReadContract (`financial_read_contract.v4`)
//
// Domain-specific contract subordinated to the conversational authority.
// The v4 wire shape remains backward compatible; the additive semantic_periods
// proof binds exact temporal windows emitted by Runtime V3 to Financial IR.

import type {
  CanonicalConversationTurnContract,
  FinancialReadSemanticRequest,
  ResolutionState,
} from "./ConversationTurnContract.ts";
import type { FinancialQueryIRv3 } from "./FinancialIRv3.ts";
import type { GroundedReference } from "./ConversationReferenceStore.ts";

export type ContractPeriodWindow = { from: string; to: string };

export type FinancialReadContractV4 = {
  version: "financial_read_contract.v4";
  source_turn_version: "conversation_turn_contract.v2";
  domain: "financial_read";
  semantic_request: FinancialReadSemanticRequest | null;
  requested: FinancialQueryIRv3;
  /** Exact canonical windows that came from the authoritative V3 turn. */
  semantic_periods: ContractPeriodWindow[];
  slots: {
    intent: ResolutionState;
    reference: ResolutionState;
    time: ResolutionState;
    entity: ResolutionState;
  };
  grounded_reference: {
    reference_id: string | null;
    target: GroundedReference["target"];
    entity_labels: string[];
  } | null;
};

function canonicalWindow(expression: string | null | undefined): ContractPeriodWindow | null {
  const match = String(expression ?? "").trim().match(/^(20\d{2}-\d{2}-\d{2})\.\.(20\d{2}-\d{2}-\d{2})$/);
  if (!match || match[1] > match[2]) return null;
  return { from: match[1], to: match[2] };
}

function semanticPeriodsOf(turn: CanonicalConversationTurnContract): ContractPeriodWindow[] {
  // period_expressions is the canonical execution scope under V3. The singular
  // period_expression may retain source wording for provenance/UI.
  const raw = turn.focus.period_expressions?.length
    ? turn.focus.period_expressions
    : turn.focus.period_expression
      ? [turn.focus.period_expression]
      : [];
  const seen = new Set<string>();
  const out: ContractPeriodWindow[] = [];
  for (const expression of raw) {
    const period = canonicalWindow(expression);
    if (!period) continue; // legacy V2/out-of-rollout remains source-compatible.
    const key = `${period.from}..${period.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(period);
  }
  return out;
}

export function buildFinancialReadContract(args: {
  turn: CanonicalConversationTurnContract;
  requested: FinancialQueryIRv3;
  grounded_reference?: GroundedReference | null;
}): FinancialReadContractV4 | null {
  if (args.turn.mode !== "read") return null;
  if (args.turn.domain !== "financial_read") return null;

  const grounded = args.grounded_reference ?? null;
  const refStatus: ResolutionState = args.turn.reference
    ? (grounded?.status === "resolved" ? "resolved" : grounded?.status === "ambiguous" ? "ambiguous" : "missing")
    : "not_applicable";

  return {
    version: "financial_read_contract.v4",
    source_turn_version: "conversation_turn_contract.v2",
    domain: "financial_read",
    semantic_request: args.turn.financial_read,
    requested: args.requested,
    semantic_periods: semanticPeriodsOf(args.turn),
    slots: {
      intent: args.turn.resolution.intent,
      reference: refStatus,
      time: args.turn.resolution.time,
      entity: args.turn.resolution.entity,
    },
    grounded_reference: args.turn.reference
      && grounded?.status === "resolved"
      && grounded.entity_labels.length > 0
      ? {
        reference_id: grounded.reference_id,
        target: grounded.target,
        entity_labels: grounded.entity_labels,
      }
      : null,
  };
}

function normalizedFilterKey(field: string, value: string): string {
  return `${field}=${value.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").trim()}`;
}

function semanticShapeOfExpected(query: FinancialReadSemanticRequest["queries"][number]): string {
  const filters = query.filters.map((f) => normalizedFilterKey(f.field, f.value)).sort().join("|");
  return [
    query.metric,
    query.operation,
    [...query.group_by].sort().join("+"),
    filters,
    query.limit ?? "null",
    query.comparison_direction ?? "any",
    query.comparison_baseline ?? "period",
    query.comparison_baseline_window ?? "null",
  ].join("/");
}

function semanticShapeOfExecuted(query: FinancialQueryIRv3["queries"][number]): string {
  const filters = query.filters.map((f) => normalizedFilterKey(f.field, String(f.value))).sort().join("|");
  return [
    query.metric,
    query.legacy_operation ?? "value",
    [...query.group_by].sort().join("+"),
    filters,
    query.limit ?? "null",
    query.comparison_direction ?? "any",
    query.comparison_baseline ?? "period",
    query.comparison_baseline_window ?? "null",
  ].join("/");
}

function semanticRequestMatchesIR(
  semantic: FinancialReadSemanticRequest | null,
  ir: FinancialQueryIRv3,
): boolean {
  if (!semantic) return true;
  if (semantic.intent !== ir.intent) return false;
  const expected = [...new Set(semantic.queries.map(semanticShapeOfExpected))].sort();
  const executed = [...new Set(ir.queries.map(semanticShapeOfExecuted))].sort();
  return expected.length === executed.length
    && expected.every((shape, index) => shape === executed[index]);
}

function financialIRWindows(ir: FinancialQueryIRv3): Set<string> {
  const windows = new Set<string>();
  const add = (period: { from?: string | null; to?: string | null } | null | undefined) => {
    if (!period?.from || !period?.to) return;
    windows.add(`${period.from}..${period.to}`);
  };
  add(ir.period);
  add(ir.comparison_period);
  for (const query of ir.queries) add(query.time);
  return windows;
}

/**
 * Every exact window emitted by V3 must still exist in the compiled IR.
 * Additional IR windows are allowed only for deterministic derived baselines.
 */
function semanticPeriodsMatchIR(contract: FinancialReadContractV4): boolean {
  if (!contract.semantic_periods.length) return true;
  const irWindows = financialIRWindows(contract.requested);
  return contract.semantic_periods.every((p) => irWindows.has(`${p.from}..${p.to}`));
}

export function validateFinancialReadContract(contract: FinancialReadContractV4 | null): string[] {
  if (!contract) return ["financial_read_contract_missing"];
  const errors: string[] = [];
  if (contract.version !== "financial_read_contract.v4") errors.push("financial_read_contract_version");
  if (contract.source_turn_version !== "conversation_turn_contract.v2") errors.push("source_turn_version_invalid");
  if (contract.domain !== "financial_read") errors.push("financial_read_domain_invalid");

  for (const [slot, state] of Object.entries(contract.slots)) {
    if (state === "ambiguous" || state === "missing" || state === "conflicting") {
      errors.push(`slot_unresolved:${slot}:${state}`);
    }
  }

  if (contract.grounded_reference?.entity_labels.length === 0) errors.push("grounded_reference_empty");
  if (!semanticRequestMatchesIR(contract.semantic_request, contract.requested)) {
    errors.push("turn_semantics_vs_financial_ir_mismatch");
  }
  if (!semanticPeriodsMatchIR(contract)) {
    errors.push("turn_period_vs_financial_ir_mismatch");
  }
  return errors;
}
