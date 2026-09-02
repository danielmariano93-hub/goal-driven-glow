// Ontologia executável (`nino_ontology.v1`): a pergunta global "estou melhorando
// ou piorando?" tem motor canônico e NUNCA pode virar `unsupported`.
import { describe, expect, it } from "vitest";
import {
  executableOntologyText, mappingForQuery, ontologyHintFor, ontologySignature,
} from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter.ts";

const period = { from: "2026-06-01", to: "2026-08-31" };
const ir = { period, comparison_period: { from: "2026-03-01", to: "2026-05-31" } };
const q = (over: Record<string, unknown> = {}) => ({
  id: "q1", metric: "expense_amount", operation: "value", group_by: [], filters: [],
  limit: null, depends_on: [], ...over,
} as any);

describe("ontologia executável", () => {
  it("saúde financeira mapeia motor holístico em value e em trend", () => {
    for (const op of ["value", "trend", "compare", "explain"]) {
      const m = mappingForQuery(q({ metric: "financial_health", operation: op }), ir as any);
      expect(m?.tool).toBe("assess_financial_health");
    }
  });

  it("tendência mês a mês usa o motor longitudinal", () => {
    const m = mappingForQuery(q({ operation: "trend", group_by: ["month"] }), ir as any);
    expect(m?.tool).toBe("analyze_longitudinal_trajectory");
  });

  it("tendência com filtro de categoria usa comparação canônica", () => {
    const m = mappingForQuery(
      q({ operation: "trend", filters: [{ field: "category", value: "Transporte" }] }),
      ir as any,
    );
    expect(m?.tool).toBe("compare_financial_metric");
    expect((m?.args as any).metric).toBe("category_spend");
  });

  it("assinatura e dica de lacuna são determinísticas", () => {
    expect(ontologySignature(q({ operation: "trend", group_by: ["weekday"] })))
      .toBe("expense_amount/trend/group:weekday/filters:none");
    expect(ontologyHintFor(q({ operation: "trend", group_by: ["weekday"] })))
      .toBe("expense_amount + trend group month");
    expect(executableOntologyText()).toContain("financial_health");
  });
});
