// InterpretationResolver (`nino_composite.v1`) — camada determinística entre
// FATOS e COMUNICAÇÃO.
//
// Regra de domínio que este módulo torna verificável:
//   ATINGIR META != EVOLUIR FINANCEIRAMENTE.
// Estourar o teto não significa piorar; ficar dentro do teto não significa
// melhorar. A LLM não decide esse estado — ele é calculado aqui.
// deno-lint-ignore-file no-explicit-any

export type OverallInterpretation =
  | "all_goals_met_and_improving"
  | "all_goals_met"
  | "improving_despite_goal_misses"
  | "regressing_despite_goals_met"
  | "mixed"
  | "deteriorating"
  | "insufficient_data";

export type InterpretationSummary = {
  version: "interpretation_resolver.v1";
  state: OverallInterpretation;
  goals_total: number;
  goals_achieved: number;
  goals_missed: number;
  improved_count: number;
  worsened_count: number;
  strongest_improvement: { category_name: string; delta: number } | null;
  strongest_deterioration: { category_name: string; delta: number } | null;
  priority: { category_name: string; reason: string } | null;
  /** Frase-conclusão determinística (a comunicação só a expressa). */
  conclusion: string;
};

const IMPROVED = new Set(["improved", "strongly_improved"]);
const WORSENED = new Set(["worsened", "strongly_worsened"]);

export function resolveInterpretation(assessment: any): InterpretationSummary {
  const categories: any[] = Array.isArray(assessment?.categories) ? assessment.categories : [];
  const canonical = assessment?.conclusions ?? {};
  const total = categories.length;
  const achieved = Number(canonical.goals_achieved ?? categories.filter((c) => c?.goal?.status === "achieved").length);
  const missed = Number(canonical.goals_missed ?? categories.filter((c) => c?.goal?.status === "missed").length);
  const improved = Number(canonical.material_improvement_count ?? canonical.improved_count ?? categories.filter((c) => IMPROVED.has(String(c?.historical?.trend))).length);
  const worsened = Number(canonical.material_worsening_count ?? canonical.worsened_count ?? categories.filter((c) => WORSENED.has(String(c?.historical?.trend))).length);

  const state: OverallInterpretation = total === 0
    ? "insufficient_data"
    : categories.every((c) => String(c?.historical?.trend) === "insufficient_data")
      ? "insufficient_data"
      : missed === 0 && improved > 0 && worsened === 0
        ? "all_goals_met_and_improving"
        : missed === 0 && worsened > 0
          ? "regressing_despite_goals_met"
          : missed === 0
            ? "all_goals_met"
            : missed > 0 && improved >= Math.max(1, worsened)
              ? "improving_despite_goal_misses"
              : missed > 0 && worsened > improved
                ? "deteriorating"
                : "mixed";

  const aggregate = assessment?.aggregate ?? {};
  const vsPrevious = Number(aggregate?.vs_previous ?? 0);
  const aggregateDirection = String(aggregate?.direction ?? (vsPrevious < 0 ? "below" : vsPrevious > 0 ? "above" : "equal"));

  const conclusion = buildConclusion({ total, missed, improved, worsened, vsPrevious, aggregateDirection });

  return {
    version: "interpretation_resolver.v1",
    state,
    goals_total: total,
    goals_achieved: achieved,
    goals_missed: missed,
    improved_count: improved,
    worsened_count: worsened,
    strongest_improvement: assessment?.conclusions?.strongest_improvement ?? null,
    strongest_deterioration: assessment?.conclusions?.strongest_deterioration ?? null,
    priority: assessment?.conclusions?.priority ?? null,
    conclusion,
  };
}

function buildConclusion(facts: {
  total: number; missed: number; improved: number; worsened: number;
  vsPrevious: number; aggregateDirection: string;
}): string {
  const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Math.abs(facts.vsPrevious));
  if (facts.total === 0) return "Ainda não tenho histórico suficiente nessas categorias para afirmar melhora ou piora.";
  if (facts.aggregateDirection === "below") {
    return `Sim. No conjunto dessas categorias, você gastou ${amount} menos que no mesmo período anterior.`;
  }
  if (facts.aggregateDirection === "above") {
    return `Não. No conjunto dessas categorias, você gastou ${amount} mais que no mesmo período anterior.`;
  }
  return "No conjunto dessas categorias, o gasto ficou igual ao mesmo período anterior.";
}
