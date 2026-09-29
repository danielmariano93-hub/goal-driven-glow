// TemporalContractV3 (`nino_temporal_contract.v1`)
//
// Time is a first-class contract in Runtime V3. The semantic model identifies
// the temporal expression and its source; deterministic code resolves it once
// into dates. Downstream layers may validate/copy these dates, never reinterpret
// the user's language or silently apply a different default.

import { resolvePeriodPt, type ResolvedPeriod } from "../../analytics/periodResolver.ts";
import { canonicalPeriodExpression, resolveExplicitPeriodPt } from "../../analytics/explicitPeriodResolver.ts";
import type { PeriodExpressionV3, SemanticTaskV3, TurnSpecV3 } from "./TurnSpecV3.ts";

export type GroundedPeriodV3 = {
  version: "nino_grounded_period.v1";
  expression: string;
  source: PeriodExpressionV3["source"];
  source_span: string | null;
  from: string;
  to: string;
  label: string;
  kind: ResolvedPeriod["kind"];
  canonical_expression: string;
};

export type TemporalContractV3 = {
  version: "nino_temporal_contract.v1";
  periods: GroundedPeriodV3[];
  errors: string[];
  ok: boolean;
};

function periodExpressions(tasks: SemanticTaskV3[]): PeriodExpressionV3[] {
  const values: PeriodExpressionV3[] = [];
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      values.push(...task.periods);
      if (task.comparison?.baseline.kind === "period" && task.comparison.baseline.period) {
        values.push(task.comparison.baseline.period);
      }
      if (task.comparison?.target) values.push(task.comparison.target);
    }
    if (task.kind === "advisory") values.push(...task.periods);
  }
  return values;
}

function key(period: Pick<GroundedPeriodV3, "from" | "to">): string {
  return `${period.from}..${period.to}`;
}

const ENGLISH_PERIOD_ALIASES: Array<[RegExp, string]> = [
  [/^this month$/i, "este mês"],
  [/^(?:last|previous) month$/i, "mês passado"],
  [/^this week$/i, "esta semana"],
  [/^(?:last|previous) week$/i, "semana passada"],
  [/^today$/i, "hoje"],
  [/^yesterday$/i, "ontem"],
  [/^this year$/i, "este ano"],
  [/^(?:last|previous) year$/i, "ano passado"],
];

function englishPeriodAlias(raw: string): string | null {
  const text = raw.trim();
  for (const [rx, pt] of ENGLISH_PERIOD_ALIASES) if (rx.test(text)) return pt;
  return null;
}

export function resolvePeriodExpressionV3(
  expression: PeriodExpressionV3,
  now: Date = new Date(),
): GroundedPeriodV3 | null {
  const raw = String(expression?.value ?? "").trim();
  if (!raw) return null;
  // Absolute/range grammar has priority because strings like
  // "semana passada do dia 21 ao dia 27" contain both an explicit subrange
  // and a relative anchor. The explicit subrange is the user's narrower truth.
  const resolve = (value: string) => value ? (resolveExplicitPeriodPt(value, now) ?? resolvePeriodPt(value, now)) : null;
  // Models occasionally normalize the expression into English ("this month").
  // The user's literal span is the primary fallback; a closed alias table
  // covers the common English renderings. Unknown text still fails closed.
  const span = String(expression?.source_span ?? "").trim();
  const resolved = resolve(raw) ?? resolve(span) ?? resolve(englishPeriodAlias(raw) ?? "");
  if (!resolved) return null;
  return {
    version: "nino_grounded_period.v1",
    expression: raw,
    source: expression.source,
    source_span: expression.source_span,
    from: resolved.from,
    to: resolved.to,
    label: resolved.label,
    kind: resolved.kind,
    canonical_expression: canonicalPeriodExpression(resolved),
  };
}

export function buildTemporalContractV3(turn: TurnSpecV3, now: Date = new Date()): TemporalContractV3 {
  if (turn.kind !== "task") {
    return { version: "nino_temporal_contract.v1", periods: [], errors: [], ok: true };
  }
  const expressions = periodExpressions(turn.tasks);
  const periods: GroundedPeriodV3[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const expression of expressions) {
    const grounded = resolvePeriodExpressionV3(expression, now);
    if (!grounded) {
      errors.push(`temporal_expression_unresolved:${String(expression.value ?? "").slice(0, 80)}`);
      continue;
    }
    const k = key(grounded);
    if (seen.has(k)) continue;
    seen.add(k);
    periods.push(grounded);
  }

  return {
    version: "nino_temporal_contract.v1",
    periods,
    errors,
    ok: errors.length === 0,
  };
}

/**
 * Canonicalize one sourced temporal slot without changing its provenance.
 * This is what the transitional V2 executor receives; it no longer receives
 * free-form temporal language that it could reinterpret differently.
 */
export function canonicalizePeriodExpressionV3(
  expression: PeriodExpressionV3 | null | undefined,
  now: Date = new Date(),
): PeriodExpressionV3 | null {
  if (!expression) return null;
  const grounded = resolvePeriodExpressionV3(expression, now);
  if (!grounded) return null;
  return {
    value: grounded.canonical_expression,
    source: expression.source,
    source_span: expression.source_span,
  };
}
