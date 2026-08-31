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
  | "stable_category_identity"
  | "arithmetic_consistent"
  | "counts_consistent"
  | "goal_analysis_period_consistent"
  | "period_role_consistent"
  | "comparison_contract_consistent";

export type GateResult = { gate: GateName; ok: boolean; detail?: string };

const IMPROVED = new Set(["improved", "strongly_improved"]);
const WORSENED = new Set(["worsened", "strongly_worsened"]);

export function runAnalysisGates(args: {
  assessment: any;
  scope: AnalysisScope;
  requirements: Requirement[];
  comparison_requested: boolean;
  expected_entity_count?: number;
  expected_current_period?: { from: string; to: string } | null;
  expected_comparison_period?: { from: string; to: string } | null;
  expected_comparison_basis?: string | null;
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

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const directionOf = (n: number) => n < 0 ? "below" : n > 0 ? "above" : "equal";
  const categoryMathOk = categories.every((c) =>
    round2(Number(c?.historical?.current ?? 0) - Number(c?.historical?.previous ?? 0)) === Number(c?.historical?.delta ?? 0)
    && directionOf(Number(c?.historical?.delta ?? 0)) === String(c?.historical?.direction ?? "")
  );
  const currentSum = round2(categories.reduce((sum, c) => sum + Number(c?.historical?.current ?? 0), 0));
  const previousSum = round2(categories.reduce((sum, c) => sum + Number(c?.historical?.previous ?? 0), 0));
  const deltaSum = round2(categories.reduce((sum, c) => sum + Number(c?.historical?.delta ?? 0), 0));
  const aggregateMathOk = currentSum === Number(a?.aggregate?.current_spend ?? NaN)
    && previousSum === Number(a?.aggregate?.previous_spend ?? NaN)
    && deltaSum === Number(a?.aggregate?.vs_previous ?? NaN)
    && directionOf(Number(a?.aggregate?.vs_previous ?? 0)) === String(a?.aggregate?.direction ?? "");
  results.push({ gate: "arithmetic_consistent", ok: categoryMathOk && aggregateMathOk,
    detail: categoryMathOk && aggregateMathOk ? undefined : "deltas ou agregado não reconciliam com as categorias" });

  const conclusions = a?.conclusions ?? {};
  const count = (direction: string) => categories.filter((c) => c?.historical?.direction === direction).length;
  const materialCount = (materiality: string) => categories.filter((c) => c?.historical?.materiality === materiality).length;
  const countsOk = Number(conclusions.below_count ?? -1) === count("below")
    && Number(conclusions.above_count ?? -1) === count("above")
    && Number(conclusions.equal_count ?? -1) === count("equal")
    && Number(conclusions.material_improvement_count ?? -1) === materialCount("material_improvement")
    && Number(conclusions.material_worsening_count ?? -1) === materialCount("material_worsening");
  results.push({ gate: "counts_consistent", ok: countsOk, detail: countsOk ? undefined : "contagens não correspondem aos itens" });

  const compatibleCategories = categories.filter((c) => String(c?.period_compatibility ?? "compatible") === "compatible");
  const incompatibleCategories = categories.filter((c) => String(c?.period_compatibility ?? "compatible") === "incompatible");
  const goalCurrentOk = compatibleCategories.every((c) => round2(Number(c?.goal?.actual ?? 0)) === round2(Number(c?.historical?.current ?? 0)))
    && incompatibleCategories.every((c) => c?.goal_period?.from && c?.analysis_period?.from);
  const mismatch = compatibleCategories.find((c) => round2(Number(c?.goal?.actual ?? 0)) !== round2(Number(c?.historical?.current ?? 0)));
  results.push({ gate: "goal_analysis_period_consistent", ok: goalCurrentOk,
    detail: goalCurrentOk ? undefined : `${mismatch?.category_name ?? "categoria"}: meta=${mismatch?.goal?.actual ?? "?"}, análise=${mismatch?.historical?.current ?? "?"}` });

  const samePeriod = (actual: any, expected: any) => !expected
    || (String(actual?.from ?? "") === expected.from && String(actual?.to ?? "") === expected.to);
  const periodOk = samePeriod(a?.period?.current, args.expected_current_period)
    && samePeriod(a?.period?.comparison, args.expected_comparison_period)
    && (!args.expected_comparison_basis || a?.period?.comparison_basis === args.expected_comparison_basis);
  results.push({ gate: "comparison_contract_consistent", ok: periodOk,
    detail: periodOk ? undefined : "período ou base de comparação diverge do plano" });
  const rolesOk = !args.comparison_requested || !args.expected_comparison_period
    || (String(args.expected_current_period?.from ?? "") !== String(args.expected_comparison_period.from)
      || String(args.expected_current_period?.to ?? "") !== String(args.expected_comparison_period.to));
  results.push({ gate: "period_role_consistent", ok: rolesOk,
    detail: rolesOk ? undefined : "período principal e comparação ocupam a mesma janela" });

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
