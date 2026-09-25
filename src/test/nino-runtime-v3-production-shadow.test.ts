import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compareSemanticSignaturesV3,
  semanticSignatureV3,
} from "../../supabase/functions/_shared/agent/v3/SemanticComparatorV3";
import type { TurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";

function spending(category: string, period = "esse mês"): TurnSpecV3 {
  return {
    version: "nino_turn_spec.v3",
    kind: "task",
    response_intent: "execute",
    act: "new_request",
    canonical_request: `Quanto gastei em ${category} ${period}?`,
    inherit_topic: false,
    references: [],
    tasks: [{
      kind: "financial_query",
      family: "financial.query",
      metric: "expense_amount",
      operation: "sum",
      group_by: [],
      filters: [{ field: "category", entity: { value: category, source: "current_turn", source_span: category } }],
      periods: [{ value: period, source: "current_turn", source_span: period }],
      limit: null,
      comparison: null,
    }],
  };
}

describe("Nino Runtime V3 production shadow", () => {
  it("detects the exact class of entity drift that caused Lazer -> Alimentação", () => {
    const official = semanticSignatureV3(spending("Alimentação"));
    const candidate = semanticSignatureV3(spending("Lazer"));
    const compared = compareSemanticSignaturesV3(official, candidate);
    expect(compared.semantic_match).toBe(false);
    expect(compared.same_entities).toBe(false);
    expect(compared.divergence_reasons).toContain("entity_mismatch");
  });

  it("does not consider slot provenance a semantic disagreement", () => {
    const official = spending("Lazer") as any;
    official.tasks[0].filters[0].entity.source = "legacy_contract";
    official.tasks[0].periods[0].source = "legacy_contract";
    const candidate = spending("Lazer");
    expect(compareSemanticSignaturesV3(
      semanticSignatureV3(official),
      semanticSignatureV3(candidate),
    ).semantic_match).toBe(true);
  });

  it("detects period drift independently from entity drift", () => {
    const compared = compareSemanticSignaturesV3(
      semanticSignatureV3(spending("Lazer", "mês passado")),
      semanticSignatureV3(spending("Lazer", "esse mês")),
    );
    expect(compared.same_entities).toBe(true);
    expect(compared.same_periods).toBe(false);
    expect(compared.divergence_reasons).toContain("period_mismatch");
  });

  it("keeps the production shadow free of financial execution side effects", () => {
    const source = readFileSync(
      "supabase/functions/_shared/agent/v3/RuntimeV3ProductionShadow.ts",
      "utf8",
    );
    expect(source).toContain("interpretSemanticTurnV3");
    expect(source).toContain("nino_runtime_v3_shadow_evaluations");
    expect(source).not.toContain("runTool(");
    expect(source).not.toContain("executeBrainWriteTurn(");
    expect(source).not.toContain("create_transaction_draft");
    expect(source).not.toContain("confirmAndBuildReceipt(");
  });

  it("keeps both V3 rollout flags off by default in the migration", () => {
    const migration = readFileSync(
      "supabase/migrations/20260925174000_nino_runtime_v3_shadow.sql",
      "utf8",
    );
    expect(migration).toContain("'runtime_v3_shadow', false, 0");
    expect(migration).toContain("'runtime_v3_authority_v1', false, 0");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.nino_runtime_v3_shadow_evaluations FROM anon, authenticated");
  });
});
