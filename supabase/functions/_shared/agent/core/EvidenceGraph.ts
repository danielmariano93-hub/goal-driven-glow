// EvidenceGraph (`nino_composite.v1`) — cada afirmação carrega sua fonte.
//
// A LLM nunca deve receber número solto: recebe claim + evidência + motor +
// período + confiança. Isso impede conclusão sem fonte e torna a auditoria do
// turno trivial.
// deno-lint-ignore-file no-explicit-any

export type EvidenceNode = {
  claim: string;
  metric: string;
  current: number;
  previous: number | null;
  source_engine: string;
  period: { from: string; to: string };
  comparison_period?: { from: string; to: string } | null;
  confidence: string;
  direction?: "below" | "above" | "equal";
};

export type EvidenceGraphPayload = {
  version: "evidence_graph.v1";
  nodes: EvidenceNode[];
  engines: string[];
};

export function buildEvidenceGraph(assessment: any): EvidenceGraphPayload {
  const categories: any[] = Array.isArray(assessment?.categories) ? assessment.categories : [];
  const current = assessment?.period?.current ?? { from: "", to: "" };
  const comparison = assessment?.period?.comparison ?? null;
  const nodes: EvidenceNode[] = [];

  for (const c of categories) {
    nodes.push({
      claim: `${c.category_name}: meta ${c.goal?.status === "achieved" ? "cumprida" : "estourada"}`,
      metric: "category_goal_attainment",
      current: Number(c.goal?.actual ?? 0),
      previous: Number(c.goal?.target ?? 0),
      source_engine: String(assessment?.formula_version ?? "goal_performance_assessment.v1"),
      period: { from: String(current.from), to: String(current.to) },
      confidence: String(c.historical?.confidence ?? "low"),
      direction: c.historical?.direction,
    });
    nodes.push({
      claim: `${c.category_name}: ${c.historical?.trend}`,
      metric: "category_expense_comparison",
      current: Number(c.historical?.current ?? 0),
      previous: Number(c.historical?.previous ?? 0),
      source_engine: String(assessment?.formula_version ?? "goal_performance_assessment.v1"),
      period: { from: String(current.from), to: String(current.to) },
      comparison_period: comparison ? { from: String(comparison.from), to: String(comparison.to) } : null,
      confidence: String(c.historical?.confidence ?? "low"),
    });
  }

  if (assessment?.aggregate) {
    nodes.push({
      claim: "Total das categorias com meta ativa",
      metric: "scoped_aggregate_expense",
      current: Number(assessment.aggregate.current_spend ?? 0),
      previous: Number(assessment.aggregate.previous_spend ?? 0),
      source_engine: String(assessment?.formula_version ?? "goal_performance_assessment.v1"),
      period: { from: String(current.from), to: String(current.to) },
      comparison_period: comparison ? { from: String(comparison.from), to: String(comparison.to) } : null,
      confidence: String(assessment?.confidence ?? "low"),
      direction: assessment.aggregate.direction,
    });
  }

  return {
    version: "evidence_graph.v1",
    nodes,
    engines: Array.isArray(assessment?.formula_versions) ? assessment.formula_versions : [],
  };
}
