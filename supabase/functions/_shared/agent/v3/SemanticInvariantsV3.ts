// Nino Runtime V3 — semantic invariants.
//
// These checks are deliberately deterministic. They are allowed to reject an
// interpretation, but never to create a different interpretation. That keeps a
// single semantic authority while still protecting the runtime from impossible
// or unsafe contracts.

import type {
  EntityFieldV3,
  SemanticReferenceV3,
  SemanticTaskV3,
  TurnSpecV3,
} from "./TurnSpecV3.ts";
import { validateTurnSpecV3 } from "./TurnSpecV3.ts";

export type SemanticInvariantResultV3 = {
  ok: boolean;
  violations: string[];
};

const ENTITY_TARGET_BY_FILTER: Partial<Record<EntityFieldV3, SemanticReferenceV3["target"]>> = {
  category: "category",
  merchant: "merchant",
  card: "card",
  account: "account",
};

function activeCurrentTurnEntityTargets(tasks: SemanticTaskV3[]): Set<string> {
  const targets = new Set<string>();
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      for (const filter of task.filters) {
        if (filter.entity.source !== "current_turn") continue;
        const target = ENTITY_TARGET_BY_FILTER[filter.field];
        if (target) targets.add(target);
      }
    }
    if (task.kind === "goal_query" && task.goal?.source === "current_turn") targets.add("goal");
  }
  return targets;
}

function inheritedReferenceTargets(references: SemanticReferenceV3[]): Set<string> {
  return new Set(
    references
      .filter((reference) => ["memory", "workflow", "legacy_contract"].includes(reference.source))
      .map((reference) => reference.target),
  );
}

/**
 * Explicit current-turn semantics always beat inherited context.
 *
 * Example of the production bug this prevents:
 * previous reference = Alimentação, current turn = "E em Lazer? Quanto gastei
 * esse mês?". A V3 may either use Lazer or ask for clarification, but it may
 * never silently reuse Alimentação.
 */
function explicitEntityOverrideViolations(turn: TurnSpecV3): string[] {
  if (turn.kind !== "task") return [];
  const explicit = activeCurrentTurnEntityTargets(turn.tasks);
  const inherited = inheritedReferenceTargets(turn.references);
  return [...explicit]
    .filter((target) => inherited.has(target))
    .map((target) => `explicit_${target}_conflicts_with_inherited_reference`);
}

/**
 * Temporal expressions are first-class period slots in V3 and are never entity
 * references. This structurally removes the class of bugs where "esse mês"
 * gets interpreted as "essa categoria" merely because both contain a
 * demonstrative pronoun.
 */
function suspiciousTemporalEntityReferenceViolations(turn: TurnSpecV3): string[] {
  const temporal = /^(?:este|esse|neste|nesse)?\s*(?:mes|mês|periodo|período|ano|semana)|^(?:hoje|ontem|amanha|amanhã)$/i;
  return turn.references
    .filter((reference) => temporal.test(reference.expression.trim()))
    .map((reference) => `temporal_expression_used_as_${reference.target}_reference`);
}

function legacySourceInAuthoritativeTurnViolations(turn: TurnSpecV3, allowLegacySource: boolean): string[] {
  if (allowLegacySource) return [];
  const violations: string[] = [];
  for (const reference of turn.references) {
    if (reference.source === "legacy_contract") violations.push("legacy_reference_in_authoritative_v3");
  }
  if (turn.kind !== "task") return violations;
  for (const task of turn.tasks) {
    if (task.kind === "financial_query") {
      for (const filter of task.filters) {
        if (filter.entity.source === "legacy_contract") violations.push("legacy_filter_in_authoritative_v3");
      }
      for (const period of task.periods) {
        if (period.source === "legacy_contract") violations.push("legacy_period_in_authoritative_v3");
      }
    }
    if (task.kind === "goal_query" && task.goal?.source === "legacy_contract") {
      violations.push("legacy_goal_in_authoritative_v3");
    }
    if (task.kind === "advisory") {
      for (const period of task.periods) {
        if (period.source === "legacy_contract") violations.push("legacy_period_in_authoritative_v3");
      }
    }
  }
  return violations;
}

export function verifySemanticInvariantsV3(
  turn: TurnSpecV3,
  options: { allowLegacySource?: boolean } = {},
): SemanticInvariantResultV3 {
  const structural = validateTurnSpecV3(turn);
  const violations = [
    ...structural.errors,
    ...explicitEntityOverrideViolations(turn),
    ...suspiciousTemporalEntityReferenceViolations(turn),
    ...legacySourceInAuthoritativeTurnViolations(turn, options.allowLegacySource === true),
  ];
  const unique = [...new Set(violations)];
  return { ok: unique.length === 0, violations: unique };
}
