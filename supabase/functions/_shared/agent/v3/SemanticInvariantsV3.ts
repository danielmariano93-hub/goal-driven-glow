// Nino Runtime V3 — semantic invariants.
//
// Deterministic checks may reject an interpretation, never create a different
// one. TurnSpecV3 remains the single semantic authority.

import { isActionKind } from "../core/ActionIR.ts";
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

function explicitEntityOverrideViolations(turn: TurnSpecV3): string[] {
  if (turn.kind !== "task") return [];
  const explicit = activeCurrentTurnEntityTargets(turn.tasks);
  const inherited = inheritedReferenceTargets(turn.references);
  return [...explicit]
    .filter((target) => inherited.has(target))
    .map((target) => `explicit_${target}_conflicts_with_inherited_reference`);
}

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

function writeActionViolations(turn: TurnSpecV3): string[] {
  if (turn.kind !== "task") return [];
  return turn.tasks
    .filter((task) => task.kind === "financial_write" && !isActionKind(task.action))
    .map((task) => `unsupported_financial_write_action:${task.kind === "financial_write" ? task.action : "unknown"}`);
}

/**
 * Canceling a PENDING workflow and undoing an ALREADY COMMITTED write are
 * different state transitions. The protocol gate consumes pending cancellation
 * before V3, but this invariant is the final safety net: a semantic model may
 * never map "deixa pra lá / não registra" to undo.last and accidentally reverse
 * an older committed operation.
 */
function cancelVsUndoViolations(turn: TurnSpecV3): string[] {
  if (turn.kind !== "task") return [];
  const undo = turn.tasks.some((task) => task.kind === "financial_write" && task.action === "undo.last");
  if (!undo) return [];
  const text = String(turn.canonical_request ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
  const pendingCancel = /\b(deixa pra la|nao registra|nao registrar|nao salva|nao salvar|nao confirma|nao confirmar|descarta|desconsidera|cancela isso|cancelar isso)\b/.test(text);
  const explicitExecutedReversal = /\b(desfaz|desfazer|desfeito|reverte|reverter|estorna|estornar|ultimo lancamento|ultima transacao|que (?:eu )?(?:registrei|lancei|confirmei)|ja (?:registrei|lancei|confirmei))\b/.test(text);
  if (pendingCancel && !explicitExecutedReversal) return ["cancel_pending_must_not_be_undo"];
  if (!explicitExecutedReversal) return ["undo_requires_explicit_committed_reversal"];
  return [];
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
    ...writeActionViolations(turn),
    ...cancelVsUndoViolations(turn),
  ];
  const unique = [...new Set(violations)];
  return { ok: unique.length === 0, violations: unique };
}
