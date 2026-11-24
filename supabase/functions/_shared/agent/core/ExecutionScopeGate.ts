// Financial execution-scope proof. Pure and independent of answer formatting.
// The model's declared intent/compiled IR is not sufficient evidence: verify
// the concrete parameters sent to the financial execution tool. Do not repair
// or silently substitute the user's requested time window here.
import type { FinancialReadContractV4 } from "./FinancialReadContract.ts";
import { independentMonthComparison } from "./IndependentTemporalOracle.ts";

type Window = { from: string; to: string };
type Call = {
  tool_name?: string;
  args?: Record<string, unknown> | null;
  result?: unknown;
  ok?: boolean;
};
export type ExecutionScopeViolation = { code: string; detail: string };

function windowOf(value: unknown): Window | null {
  if (!value || typeof value !== "object") return null;
  const w = value as Record<string, unknown>;
  if (typeof w.from !== "string" || typeof w.to !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.from) || !/^\d{4}-\d{2}-\d{2}$/.test(w.to) || w.from > w.to) return null;
  return { from: w.from, to: w.to };
}

function key(value: Window) { return `${value.from}..${value.to}`; }
function sameWindows(a: Window[], b: Window[]) {
  return a.length === b.length && a.map(key).sort().every((item, i) => item === b.map(key).sort()[i]);
}

/**
 * Strong proof for financial comparison calls: one executed pair, two concrete
 * windows, exact match against the authoritative IR. A mismatch is a violation
 * even when the returned numbers look plausible.
 *
 * No false confidence when evidence is unavailable. Older unsupported
 * comparison tools are not assessed by this gate until their typed contracts
 * are adopted; they remain covered by existing IR/preservation checks.
 */
export function verifyExecutedFinancialScopes(
  contract: FinancialReadContractV4 | null,
  toolCalls: readonly Call[],
  options: { requested_text?: string | null; reference_date?: string } = {},
): ExecutionScopeViolation[] {
  if (!contract) return [];
  const requestedCompare = contract.requested.queries.some(q => q.legacy_operation === "compare");
  if (!requestedCompare) return [];
  const calls = toolCalls.filter(c => c.tool_name === "compare_periods");
  if (!calls.length) return []; // Gate for this tool, not for other engines.
  const base = windowOf(contract.requested.period);
  const previous = windowOf(contract.requested.comparison_period);
  if (!base || !previous) return [{ code: "comparison_scope_unverifiable", detail: "authoritative IR missing comparison windows" }];
  const expected = [base, previous];
  const violations: ExecutionScopeViolation[] = [];
  const sourceScope = options.requested_text
    ? independentMonthComparison(options.requested_text, options.reference_date)
    : null;
  for (const call of calls) {
    if (call.ok !== true) continue; // Failed call already handled by execution status.
    const actualA = windowOf(call.args?.period_a);
    const actualB = windowOf(call.args?.period_b);
    if (sourceScope && (!actualA || !actualB
      || !sameWindows([sourceScope.target, sourceScope.baseline], [actualA, actualB]))) {
      violations.push({
        code: "original_request_vs_executed_window_mismatch",
        detail: "executed comparison contradicts independently recognized user-requested calendar relation",
      });
    }
    if (!actualA || !actualB || !sameWindows(expected, [actualA, actualB])) {
      violations.push({
        code: "comparison_execution_window_mismatch",
        detail: "compare_periods arguments do not match the approved financial read IR",
      });
      continue;
    }
    const output = call.result;
    if (output && typeof output === "object") {
      const result = output as Record<string, unknown>;
      const reportedA = windowOf(result.period_a);
      const reportedB = windowOf(result.period_b);
      if ((reportedA && !sameWindows([reportedA], [actualA]))
        || (reportedB && !sameWindows([reportedB], [actualB]))) {
        violations.push({
          code: "comparison_result_window_mismatch",
          detail: "financial engine reported period differs from executed tool arguments",
        });
      }
    }
  }
  return violations;
}
