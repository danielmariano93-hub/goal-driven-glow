import { describe, expect, it } from "vitest";
import {
  ANALYTICAL_CONTRACT_VERSION,
  AGENT_RUNTIME_VERSION,
} from "../../supabase/functions/_shared/agent/core/RuntimeContract";
import {
  classifyProtectedAnalyticalQuery,
  findCompositeAnalysisPlan,
  isToolAllowedForAnalysisKind,
  validateAnalyticalTruth,
} from "../../supabase/functions/_shared/agent/core/AnalyticalTruthGate";
import { createConversationMemory } from "../../supabase/functions/_shared/agent/core/ConversationMemory";

const CATEGORY_IDS = ["c1", "c2", "c3"];

function failedGates(result: ReturnType<typeof validateAnalyticalTruth>) {
  return result.gates.filter((gate) => !gate.passed);
}

describe("classificação de consulta analítica protegida", () => {
  it("protege a frase exata do incidente", () => {
    const result = classifyProtectedAnalyticalQuery(
      "dessas categorias, quanto eu gastei em agosto em comparação a julho?",
      CATEGORY_IDS,
    );
    expect(result.protected).toBe(true);
    expect(result.kind).toBe("goal_performance_analysis");
    expect(result.reasons).toContain("scoped_comparison");
  });

  it("protege follow-up elíptico quando existe escopo herdado", () => {
    const result = classifyProtectedAnalyticalQuery("e agosto contra julho?", CATEGORY_IDS);
    expect(result.protected).toBe(true);
    expect(result.reasons).toContain("scoped_comparison");
  });

  it("é anafórica e protegida mesmo SEM escopo (fail-closed, não agregado)", () => {
    const result = classifyProtectedAnalyticalQuery("dessas categorias, agosto contra julho?", []);
    expect(result.protected).toBe(true);
    expect(result.reasons).toContain("unresolved_entity_reference");
  });

  it("não protege comparação global legítima", () => {
    const result = classifyProtectedAnalyticalQuery("quanto gastei em agosto comparado a julho?", []);
    expect(result.protected).toBe(false);
  });

  it("não protege conversa sem comparação", () => {
    const result = classifyProtectedAnalyticalQuery("como posso economizar mais?", CATEGORY_IDS);
    expect(result.protected).toBe(false);
  });
});

describe("allowlist de motor", () => {
  it("goal_performance_analysis só aceita assess_goal_performance", () => {
    expect(isToolAllowedForAnalysisKind("goal_performance_analysis", "assess_goal_performance")).toBe(true);
    expect(isToolAllowedForAnalysisKind("goal_performance_analysis", "analytics_compare")).toBe(false);
    expect(isToolAllowedForAnalysisKind("goal_performance_analysis", "compare_to_monthly_average")).toBe(false);
  });
});

describe("plano analítico para a pergunta do incidente", () => {
  it("protege a frase completa do print em um único turno", () => {
    const plan = findCompositeAnalysisPlan(
      "Você disse que alimentação, transporte e lazer são as categorias mais acima da média. Quanto eu gastei nessas categorias em agosto comparado a julho?",
      [],
    );
    expect(plan).not.toBeNull();
    expect(plan?.analysis_kind).toBe("goal_performance_analysis");
    expect(plan?.required_tool).toBe("assess_goal_performance");
    expect(plan?.entity_scope_source).toBe("inline_named_categories");
  });

  it("casa o plano, preserva os IDs herdados e usa a ferramenta canônica", () => {
    const plan = findCompositeAnalysisPlan(
      "dessas categorias, quanto eu gastei em agosto em comparação a julho?",
      CATEGORY_IDS,
    );
    expect(plan).not.toBeNull();
    expect(plan?.analysis_kind).toBe("goal_performance_analysis");
    expect(plan?.required_tool).toBe("assess_goal_performance");
    expect(plan?.expected_entity_ids).toEqual(CATEGORY_IDS);
    expect(plan?.entity_scope_source).toBe("inherited_category_ids");
  });

  it("compara agosto contra julho — nunca maio/junho", () => {
    const plan = findCompositeAnalysisPlan(
      "dessas categorias, quanto eu gastei em agosto em comparação a julho?",
      CATEGORY_IDS,
    );
    expect(plan?.tool_args).toMatchObject({
      current_period: { from: "2026-08-01", to: "2026-08-31" },
      comparison_period: { from: "2026-07-01", to: "2026-07-31" },
    });
  });

  it("follow-up elíptico curto também casa plano composto", () => {
    const plan = findCompositeAnalysisPlan("e agosto contra julho?", CATEGORY_IDS);
    expect(plan).not.toBeNull();
    expect(plan?.required_tool).toBe("assess_goal_performance");
  });
});

describe("gate entity_set_identity", () => {
  it("passa quando a evidência é exatamente o conjunto pedido", () => {
    const gates = validateAnalyticalTruth({
      analysis_kind: "goal_performance_analysis",
      required_tool: "assess_goal_performance",
      actual_tool: "assess_goal_performance",
      requested_entity_ids: CATEGORY_IDS,
      returned_entity_ids: CATEGORY_IDS,
      expected_current_period: { from: "2026-08-01", to: "2026-08-31" },
      actual_current_period: { from: "2026-08-01", to: "2026-08-31" },
      expected_comparison_period: { from: "2026-07-01", to: "2026-07-31" },
      actual_comparison_period: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(gates.ok).toBe(true);
  });

  it("bloqueia quando a evidência trouxe outro conjunto (escopo trocado)", () => {
    const gates = validateAnalyticalTruth({
      analysis_kind: "goal_performance_analysis",
      required_tool: "assess_goal_performance",
      actual_tool: "assess_goal_performance",
      requested_entity_ids: CATEGORY_IDS,
      returned_entity_ids: ["x1", "x2"],
      expected_current_period: { from: "2026-08-01", to: "2026-08-31" },
      actual_current_period: { from: "2026-08-01", to: "2026-08-31" },
      expected_comparison_period: { from: "2026-07-01", to: "2026-07-31" },
      actual_comparison_period: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(failedGates(gates).map((g) => g.gate)).toContain("entity_set_identity");
  });

  it("bloqueia período divergente do plano (julho vs maio/junho)", () => {
    const gates = validateAnalyticalTruth({
      analysis_kind: "goal_performance_analysis",
      required_tool: "assess_goal_performance",
      actual_tool: "assess_goal_performance",
      requested_entity_ids: CATEGORY_IDS,
      returned_entity_ids: CATEGORY_IDS,
      expected_current_period: { from: "2026-08-01", to: "2026-08-20" },
      actual_current_period: { from: "2026-08-01", to: "2026-08-20" },
      expected_comparison_period: { from: "2026-07-01", to: "2026-07-31" },
      actual_comparison_period: { from: "2026-05-01", to: "2026-06-30" },
    });
    expect(failedGates(gates).map((g) => g.gate)).toContain("comparison_contract_consistent");
  });
});

describe("contrato de runtime", () => {
  it("expõe versões estampadas em cada run", () => {
    expect(AGENT_RUNTIME_VERSION).toBe("nino-agent-p0.2026-09-23.1");
    expect(ANALYTICAL_CONTRACT_VERSION).toBe("nino_analytical.v5");
  });
});

// ---- Reprodução de DOIS TURNOS do incidente real -------------------------
describe("incidente em dois turnos (overview → comparação anafórica)", () => {
  it("turno 1 grava o escopo do fluxo antigo e turno 2 roda o motor canônico com os mesmos IDs", () => {
    const memory = createConversationMemory();
    memory.last_result = {
      kind: "comparison",
      entities: [
        { id: "c1", label: "Alimentação" },
        { id: "c2", label: "Transporte" },
        { id: "c3", label: "Lazer" },
      ],
      period: null,
      source_tool: "compare_to_monthly_average",
      created_at: new Date().toISOString(),
    };

    const inheritedIds = memory.last_result.entities.map((entity) => entity.id);
    const plan = findCompositeAnalysisPlan(
      "dessas categorias, quanto eu gastei em agosto em comparação a julho?",
      inheritedIds,
    );

    expect(plan?.expected_entity_ids).toEqual(CATEGORY_IDS);
    expect(plan?.required_tool).toBe("assess_goal_performance");
    expect(plan?.tool_args).toMatchObject({
      category_ids: CATEGORY_IDS,
      current_period: { from: "2026-08-01", to: "2026-08-31" },
      comparison_period: { from: "2026-07-01", to: "2026-07-31" },
    });
  });
});
