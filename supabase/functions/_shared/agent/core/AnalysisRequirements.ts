// AnalysisRequirements (`nino_composite.v1`) — o que a resposta PRECISA conter.
//
// Sem este contrato, "responder uma parte" era indistinguível de "responder".
// Aqui cada componente pedido é declarado antes da execução e marcado como
// resolvido/parcial/ausente depois — é isso que o validador de completude lê.

export type RequiredAnswer =
  | "active_goals"
  | "attainment_per_goal"
  | "historical_comparison_per_entity"
  | "scoped_aggregate"
  | "overall_interpretation"
  | "ranking"
  | "priority";

export type RequirementStatus = "resolved" | "partial" | "unresolved";

export type Requirement = {
  key: RequiredAnswer;
  cardinality: "single" | "per_entity";
  /** Quantas entidades precisam estar cobertas (quando `per_entity`). */
  entity_count?: number;
  status: RequirementStatus;
  /** Quantas entidades foram efetivamente cobertas. */
  covered?: number;
};

export function requirement(
  key: RequiredAnswer,
  cardinality: "single" | "per_entity" = "single",
): Requirement {
  return { key, cardinality, status: "unresolved" };
}

export function markResolved(
  requirements: Requirement[],
  key: RequiredAnswer,
  coverage?: { required: number; covered: number },
): Requirement[] {
  return requirements.map((r) => {
    if (r.key !== key) return r;
    if (!coverage) return { ...r, status: "resolved" as RequirementStatus };
    const status: RequirementStatus = coverage.covered === 0
      ? "unresolved"
      : coverage.covered >= coverage.required
        ? "resolved"
        : "partial";
    return { ...r, entity_count: coverage.required, covered: coverage.covered, status };
  });
}

export const REQUIRED_ANSWER_LABEL_PT: Record<RequiredAnswer, string> = {
  active_goals: "a lista das suas metas ativas",
  attainment_per_goal: "o desempenho de cada meta",
  historical_comparison_per_entity: "a comparação de cada categoria com o período anterior",
  scoped_aggregate: "o total dessas categorias",
  overall_interpretation: "a leitura geral",
  ranking: "o ranking entre elas",
  priority: "o ponto de atenção",
};
