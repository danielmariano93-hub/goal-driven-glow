import { describe, expect, it } from "vitest";
import { applyTurnAspect } from "../../supabase/functions/_shared/agent/core/SemanticAspectOverlay";
import { normalizeToV3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import type { FinancialQueryIR } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";

const NOW = new Date("2026-09-26T16:00:00-03:00");

function trendIR(from: string, to: string, label = "período"): FinancialQueryIR {
  return {
    version: "financial_query_ir.v1",
    intent: "analyze",
    needs_clarification: [],
    assumptions: [],
    queries: [{
      id: "q1",
      metric: "expense_amount",
      operation: "trend",
      group_by: ["month"],
      filters: [{ field: "category", op: "eq", value: "Lazer" }],
      limit: null,
    }],
    completeness_targets: ["q1.money"],
    period: { from, to, label },
    comparison_period: null,
    source: "semantic_compiler",
    unsupported_reason: null,
  };
}

describe("monthly calendar window regression", () => {
  it("corrige o bug de produção: mês a mês usa o primeiro dia do primeiro mês", () => {
    const v3 = normalizeToV3(
      trendIR("2026-04-26", "2026-09-26", "últimos 6 meses"),
      { today: "2026-09-26" },
    );

    // Simula exatamente a divergência observada em produção: o compilador
    // acertou `trend`, mas trouxe uma janela dia-26 -> dia-26.
    expect(v3.queries[0].time).toMatchObject({
      aspect: "trend",
      from: "2026-04-26",
      to: "2026-09-26",
    });

    const out = applyTurnAspect(
      v3,
      "Quanto gastei com Lazer mês a mês nos últimos 6 meses?",
      NOW,
    );

    expect(out.applied).toBe(true);
    expect(out.changed_queries).toEqual(["q1"]);
    expect(out.ir.queries[0]).toMatchObject({
      time: {
        aspect: "trend",
        from: "2026-04-01",
        to: "2026-09-26",
        n: 6,
        exclude_partial: false,
        label: "últimos 6 meses, mês a mês",
      },
      grain: "month",
      reduce: "none",
    });
  });

  it("preserva a semântica quando o usuário pede meses fechados", () => {
    const v3 = normalizeToV3(
      trendIR("2026-04-26", "2026-09-26", "últimos 5 meses fechados"),
      { today: "2026-09-26" },
    );
    const out = applyTurnAspect(
      v3,
      "Quanto gastei com Lazer mês a mês nos últimos 5 meses fechados?",
      NOW,
    );

    expect(out.ir.queries[0].time).toMatchObject({
      aspect: "trend",
      from: "2026-04-01",
      to: "2026-08-31",
      n: 5,
      exclude_partial: true,
    });
  });

  it("não reescreve uma tendência genérica sem janela mensal N explícita", () => {
    const v3 = normalizeToV3(
      trendIR("2026-08-01", "2026-09-26", "recorte já definido"),
      { today: "2026-09-26" },
    );
    const out = applyTurnAspect(v3, "Qual a tendência de Lazer?", NOW);

    expect(out.applied).toBe(false);
    expect(out.ir.queries[0].time).toMatchObject({
      from: "2026-08-01",
      to: "2026-09-26",
    });
  });
});
