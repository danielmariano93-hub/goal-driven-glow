// AnalysisGates (`nino_composite.v1`) — truth gates VERIFICÁVEIS sobre o
// resultado da análise composta. Cada gate é uma regra de domínio que já foi
// violada em produção pelo menos uma vez.
// deno-lint-ignore-file no-explicit-any
import { checkScopePreservation, type AnalysisScope } from "./ScopeResolver.ts";
import type { Requirement } from "./AnalysisRequirements.ts";

export type GateName =
  | "goal_missed_not_worsening"
  | "goal_achieved_not_improving"
  | "scope_preserved"
  | "entities_complete"
  | "comparison_present"
  | "evidence_fresh"
  | "stable_category_identity";

export type GateResult = { gate: GateName; ok: boolean; detail?: string };

const IMPROVED = new Set(["improved", "strongly_improved"]);
const WORSENED = new Set(["worsened", "strongly_worsened"]);

export function runAnalysisGates(args: {
  assessment: any;
  scope: AnalysisScope;
  requirements: Requirement[];
  comparison_requested: boolean;
  expected_entity_count?: number;
}): GateResult[] {
  const a = args.assessment ?? {};
  const categories: any[] = Array.isArray(a.categories) ? a.categories : [];
  const results: GateResult[] = [];

  // A) meta estourada NÃO implica piora histórica.
  const badMissed = categories.find((c) =>
    c?.goal?.status === "missed"
    && IMPROVED.has(String(c?.historical?.trend))
    && String(c?.interpretation?.state) !== "goal_missed_but_improved"
  );
  results.push({
    gate: "goal_missed_not_worsening",
    ok: !badMissed,
    detail: badMissed ? `${badMissed.category_name} melhorou mas foi classificada como piora` : undefined,
  });

  // B) meta cumprida NÃO implica melhora histórica.
  const badAchieved = categories.find((c) =>
    c?.goal?.status === "achieved"
    && WORSENED.has(String(c?.historical?.trend))
    && String(c?.interpretation?.state) !== "goal_achieved_but_worsened"
  );
  results.push({
    gate: "goal_achieved_not_improving",
    ok: !badAchieved,
    detail: badAchieved ? `${badAchieved.category_name} piorou mas foi classificada como melhora` : undefined,
  });

  // C) escopo travado nunca vira agregado global.
  const violation = checkScopePreservation(args.scope, a.aggregate);
  results.push({
    gate: "scope_preserved",
    ok: !violation,
    detail: violation ? `esperado ${violation.expected}, encontrado ${violation.found}` : undefined,
  });

  // D) todas as entidades pedidas foram analisadas.
  const expected = args.expected_entity_count ?? categories.length;
  results.push({
    gate: "entities_complete",
    ok: categories.length >= expected && expected > 0,
    detail: categories.length < expected ? `${categories.length} de ${expected} analisadas` : undefined,
  });

  // E) comparação pedida existe de fato.
  const hasComparison = categories.length > 0
    && categories.every((c) => c?.historical && typeof c.historical.previous === "number");
  results.push({
    gate: "comparison_present",
    ok: !args.comparison_requested || hasComparison,
    detail: args.comparison_requested && !hasComparison ? "comparação ausente na evidência" : undefined,
  });

  // F) evidência crítica não pode estar stale e assertiva ao mesmo tempo.
  const stale = Boolean(a?.freshness?.stale);
  const lowConfidence = ["low", "insufficient"].includes(String(a?.confidence ?? ""));
  results.push({
    gate: "evidence_fresh",
    ok: !stale || lowConfidence,
    detail: stale && !lowConfidence ? "cache desatualizado servido com confiança alta" : undefined,
  });

  // G) a mesma categoria precisa ter a mesma identidade nos dois períodos.
  const ids = categories.map((c) => String(c?.category_id ?? ""));
  const stableIdentity = ids.every((id) => id.length > 0) && new Set(ids).size === ids.length;
  results.push({
    gate: "stable_category_identity",
    ok: categories.length === 0 || stableIdentity,
    detail: stableIdentity ? undefined : "identidade de categoria duplicada ou ausente",
  });

  return results;
}

export function gatesPassed(results: GateResult[]): boolean {
  return results.every((r) => r.ok);
}

export function failedGates(results: GateResult[]): GateResult[] {
  return results.filter((r) => !r.ok);
}
