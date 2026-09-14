import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveMultiPeriodsPt, resolvePeriodExpressions } from "../../supabase/functions/_shared/analytics/multiPeriodResolver.ts";
import { expandIRForPeriods } from "../../supabase/functions/_shared/agent/core/MultiPeriodPlan.ts";
import { multiPeriodText } from "../../supabase/functions/_shared/agent/core/MultiPeriodAnswer.ts";
import { normalizeConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract.ts";
import { validateFinancialIRv2, type FinancialQueryIRv2 } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR.ts";
import { reviewWindow } from "../../supabase/functions/_shared/agent/core/AdvisorReviewServiceV2.ts";

const NOW = new Date("2026-09-14T13:30:00-03:00");

function baseCategorySpend(): FinancialQueryIRv2 {
  return {
    version: "financial_query_ir.v2",
    intent: "lookup",
    dialogue: { acts: ["new_query"], topic_id: null, inherits_from_topic_id: null },
    needs_clarification: [],
    assumptions: [],
    queries: [{
      id: "q1", metric: "expense_amount", operation: "sum", group_by: [],
      filters: [{ field: "category", op: "eq", value: "Alimentação" }],
      limit: null, depends_on: [],
    }],
    completeness_targets: [{ id: "q1.money", query_id: "q1", claim: "money", required: true }],
    period: { from: "2026-07-01", to: "2026-07-31", label: "julho" },
    comparison_period: null,
    source: "semantic_compiler",
    unsupported_reason: null,
  };
}

describe("period_truth.v2 — multi-period reads", () => {
  it("resolve o incidente real julho + agosto como dois períodos completos", () => {
    const got = resolveMultiPeriodsPt("Nino, quanto eu gastei em alimentação no mês de julho e agosto?", NOW);
    expect(got.source).toBe("enumeration");
    expect(got.comparison_intent).toBe(false);
    expect(got.periods.map((p) => [p.from, p.to])).toEqual([
      ["2026-07-01", "2026-07-31"],
      ["2026-08-01", "2026-08-31"],
    ]);
  });

  it("suporta três meses nomeados sem criar regra por mês", () => {
    const got = resolveMultiPeriodsPt("me traga março, abril e maio", NOW);
    expect(got.periods.map((p) => p.label)).toEqual(["marco", "abril", "maio"]);
    expect(got.periods).toHaveLength(3);
  });

  it("mês único mantém compatibilidade", () => {
    const got = resolveMultiPeriodsPt("quanto gastei em agosto?", NOW);
    expect(got.source).toBe("single");
    expect(got.periods).toHaveLength(1);
    expect(got.periods[0].from).toBe("2026-08-01");
  });

  it("vs/comparação é separado de enumeração simples", () => {
    expect(resolveMultiPeriodsPt("julho vs agosto", NOW).comparison_intent).toBe(true);
    expect(resolveMultiPeriodsPt("julho e agosto", NOW).comparison_intent).toBe(false);
  });

  it("expressões emitidas pelo Brain são resolvidas pelo backend, não pela LLM", () => {
    const got = resolvePeriodExpressions(["julho", "agosto"], "quanto gastei?", NOW);
    expect(got.periods.map((p) => p.label)).toEqual(["julho", "agosto"]);
  });
});

describe("Financial IR fan-out", () => {
  it("compila o contrato uma vez e preserva categoria em cada período", () => {
    const periods = resolveMultiPeriodsPt("julho e agosto", NOW).periods;
    const expanded = expandIRForPeriods(baseCategorySpend(), periods, false);
    expect(expanded.applied).toBe(true);
    expect(expanded.mode).toBe("fanout");
    expect(expanded.ir.queries).toHaveLength(2);
    expect(expanded.ir.queries.map((q) => q.filters[0]?.value)).toEqual(["Alimentação", "Alimentação"]);
    expect(expanded.ir.queries.map((q) => q.period?.from)).toEqual(["2026-07-01", "2026-08-01"]);
    expect(validateFinancialIRv2(expanded.ir)).toEqual([]);
  });

  it("resposta multi-período rotula cada engine result", () => {
    const text = multiPeriodText({
      outcomes: [
        { query_id: "q1@p0", engine: "analyze_spending", status: "ok", result: { metric: "expense", total_metric: 1340.48, by_category: [] } },
        { query_id: "q1@p1", engine: "analyze_spending", status: "ok", result: { metric: "expense", total_metric: 1317.08, by_category: [] } },
      ],
      labels: { "q1@p0": "julho", "q1@p1": "agosto" },
      periodOrder: ["julho", "agosto"],
      comparison_intent: false,
    });
    expect(text).toContain("*Julho*");
    expect(text).toContain("*Agosto*");
    expect(text).not.toContain("me diga o período");
  });
});

describe("Conversation contract + natural continuation", () => {
  it("preserva todas as expressões temporais e compatibilidade com period_expression", () => {
    const c = normalizeConversationTurnContract({
      act: "new_request", mode: "read", canonical_request: "Quanto gastei em alimentação em julho e agosto?",
      inherit_focus: false,
      focus: { category: "Alimentação", merchant: null, goal: null, period_expression: "julho", period_expressions: ["julho", "agosto"] },
      action: null, direct_reply: null, clarification_question: null, confidence: 0.99,
    });
    expect(c?.focus.period_expression).toBe("julho");
    expect(c?.focus.period_expressions).toEqual(["julho", "agosto"]);
  });

  it("o Brain recebe last_analysis e contexto persistente sem virar fonte numérica", () => {
    const brain = readFileSync("supabase/functions/_shared/agent/core/ConversationBrain.ts", "utf8");
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    const context = readFileSync("supabase/functions/_shared/agent/core/BrainUserContext.ts", "utf8");
    expect(brain).toContain("last_analysis");
    expect(brain).toContain("UserContext");
    expect(core).toContain("loadBrainUserContext");
    expect(core).toContain('kind: "multi_period_read"');
    expect(context).toContain("not a financial truth source");
  });
});

describe("advisor review weekly window", () => {
  it("segunda-feira usa a semana FECHADA anterior", () => {
    const w = reviewWindow("weekly", NOW);
    expect(w).toEqual({
      start: "2026-09-07", end: "2026-09-13",
      previousStart: "2026-08-31", previousEnd: "2026-09-06",
    });
  });

  it("quarta-feira também nunca inclui dias futuros", () => {
    const w = reviewWindow("weekly", new Date("2026-09-16T12:00:00-03:00"));
    expect(w.start).toBe("2026-09-07");
    expect(w.end).toBe("2026-09-13");
    expect(w.end < "2026-09-16").toBe(true);
  });
});

describe("V2 observability and safety wiring", () => {
  it("agent_runs usa path permitido e carimba a arquitetura", () => {
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(core).toContain('path: "llm"');
    expect(core).toContain("conversation_architecture");
    expect(core).toContain("conversation_brain_run_persist_failed");
    expect(core).not.toContain('path: "conversation_brain_v1"');
  });

  it("V2 continua com Preservation Gate obrigatório e habitual mensal protegido", () => {
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(core).toContain("preservation_enforced: true");
    expect(core).toContain("typical_monthly_enabled: true");
  });

  it("não reintroduz routers concorrentes no hot path V2", () => {
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(core).not.toContain("classifyCapability(");
    expect(core).not.toContain("routeIntent(");
  });
});
