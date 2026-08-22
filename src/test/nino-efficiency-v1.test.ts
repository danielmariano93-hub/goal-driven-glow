// nino_efficiency.v1 — provas determinísticas da camada de eficiência:
// compressão de evidência, orçamento por ferramenta, renderização sem LLM e
// custo estimado por tier de modelo.
import { describe, expect, it } from "vitest";
import { compressToolResult } from "../../supabase/functions/_shared/agent/core/EvidencePack.ts";
import { budgetFor } from "../../supabase/functions/_shared/agent/core/ToolBudget.ts";
import { formatEngineNarrative } from "../../supabase/functions/_shared/agent/core/DeterministicAnswers.ts";
import { estimateCost } from "../../supabase/functions/_shared/agent/core/Observability.ts";
import { tierForTask, MODEL_TIERS } from "../../supabase/functions/_shared/intelligence/modelGateway.ts";

const performanceEnvelope = {
  engine: "financial_performance",
  facts: {
    headline: "Você melhorou em alguns pontos, mas ainda tem ponto de atenção neste recorte.",
    next_action: "Definir um teto para Educação",
    main_attention: {
      title: "Educação: alta de R$ 806,40",
      body: "Educação subiu R$ 806,40 no mesmo recorte.",
      severity: "attention",
    },
    main_improvement: {
      title: "Gasto abaixo do período comparado",
      body: "Seu gasto caiu R$ 5.947,93 nesse recorte.",
      severity: "info",
    },
  },
  evidence: { period: { from: "2026-07-22", to: "2026-08-21" }, sample_size: 143 },
  confidence: "high",
  breakdown: Array.from({ length: 120 }, (_, i) => ({ id: i, label: `item ${i}`, amount: i * 13.5 })),
};

describe("nino_efficiency.v1 — compressão de evidência", () => {
  it("reduz drasticamente o resultado enviado ao modelo", () => {
    const full = JSON.stringify(performanceEnvelope);
    const packed = compressToolResult("assess_financial_performance", performanceEnvelope);
    expect(packed.length).toBeLessThan(full.length / 2);
    expect(packed.length).toBeLessThanOrEqual(budgetFor("assess_financial_performance"));
  });

  it("preserva as chaves de verdade (fatos, confiança e evidência)", () => {
    const packed = compressToolResult("assess_financial_performance", performanceEnvelope);
    expect(packed).toContain("headline");
    expect(packed).toContain("confidence");
    expect(packed).toContain("2026-08-21");
  });

  it("nunca ultrapassa o orçamento, mesmo com resultado gigante", () => {
    const huge = { rows: Array.from({ length: 5000 }, (_, i) => ({ i, note: "x".repeat(40) })) };
    const packed = compressToolResult("list_transactions", huge);
    expect(packed.length).toBeLessThanOrEqual(budgetFor("list_transactions"));
  });
});

describe("nino_efficiency.v1 — resposta sem LLM", () => {
  it("renderiza o envelope do motor sem chamar modelo", () => {
    const reply = formatEngineNarrative(performanceEnvelope);
    expect(reply).toBeTruthy();
    expect(reply).toContain("ponto de atenção");
    expect(reply).toContain("Educação subiu R$ 806,40");
    expect(reply).toContain("Próximo passo: Definir um teto para Educação");
  });

  it("não inventa números: sem frase do motor, devolve null e escala", () => {
    expect(formatEngineNarrative({ facts: { total: 1234.5 } })).toBeNull();
    expect(formatEngineNarrative(null)).toBeNull();
  });
});

describe("nino_efficiency.v1 — custo e tiers", () => {
  it("cobra mais barato o tier leve que o tier de raciocínio", () => {
    const light = estimateCost(MODEL_TIERS[tierForTask("fast_operation")].primary, 3000, 400);
    const heavy = estimateCost(MODEL_TIERS[tierForTask("complex_reasoning")].primary, 3000, 400);
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(heavy);
  });

  it("classificação semântica não usa o tier mais caro", () => {
    expect(tierForTask("semantic_classification")).not.toBe(tierForTask("complex_reasoning"));
  });
});
