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
  const total = categories.length;
  const achieved = categories.filter((c) => c?.goal?.status === "achieved").length;
  const missed = categories.filter((c) => c?.goal?.status === "missed").length;
  const improved = categories.filter((c) => IMPROVED.has(String(c?.historical?.trend))).length;
  const worsened = categories.filter((c) => WORSENED.has(String(c?.historical?.trend))).length;

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

  const conclusion = buildConclusion(state, { total, missed, improved, worsened, vsPrevious });

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

function buildConclusion(
  state: OverallInterpretation,
  facts: { total: number; missed: number; improved: number; worsened: number; vsPrevious: number },
): string {
  const menos = facts.vsPrevious < 0;
  switch (state) {
    case "all_goals_met_and_improving":
      return "Sim: você ficou dentro de todas as metas e ainda gastou menos que no período anterior.";
    case "all_goals_met":
      return "Você ficou dentro de todas as metas dessas categorias.";
    case "improving_despite_goal_misses":
      return menos
        ? `Sim: mesmo estourando ${facts.missed} ${facts.missed === 1 ? "meta" : "metas"}, você gastou menos que no período anterior na maior parte dessas categorias.`
        : `Você estourou ${facts.missed} ${facts.missed === 1 ? "meta" : "metas"}, mas reduziu o gasto em ${facts.improved} ${facts.improved === 1 ? "categoria" : "categorias"} em relação ao período anterior.`;
    case "regressing_despite_goals_met":
      return "Você ficou dentro das metas, mas gastou mais que no período anterior — meta cumprida não é o mesmo que evolução.";
    case "deteriorating":
      return `Aqui o sinal é de atenção: ${facts.missed} ${facts.missed === 1 ? "meta estourada" : "metas estouradas"} e gasto acima do período anterior em ${facts.worsened} ${facts.worsened === 1 ? "categoria" : "categorias"}.`;
    case "mixed":
      return "O quadro é misto: em parte dessas categorias você avançou e em outra parte regrediu em relação ao período anterior.";
    default:
      return "Ainda não tenho histórico suficiente nessas categorias para afirmar melhora ou piora.";
  }
}
