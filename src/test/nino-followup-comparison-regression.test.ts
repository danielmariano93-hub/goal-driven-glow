import { describe, expect, it, vi } from "vitest";
import { fastFinancialIR } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";
import { resolveMultiPeriodsPt } from "../../supabase/functions/_shared/analytics/multiPeriodResolver";
import { expandIRForPeriods } from "../../supabase/functions/_shared/agent/core/MultiPeriodPlan";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";

const JULY = { from: "2026-07-01", to: "2026-07-31", label: "julho" };
const AUGUST = { from: "2026-08-01", to: "2026-08-31", label: "agosto" };
const TEXT = "Qual categoria teve o maior aumento de gasto entre julho e agosto?";

function compareIr() {
  return {
    version: "financial_query_ir.v1" as const,
    intent: "analyze" as const,
    needs_clarification: [],
    assumptions: [],
    queries: [{
      id: "q1",
      metric: "expense_amount" as const,
      operation: "compare" as const,
      group_by: ["category" as const],
      filters: [],
      limit: 5,
    }],
    completeness_targets: ["q1.direction"],
    period: JULY,
    comparison_period: null,
    source: "semantic_compiler" as const,
    unsupported_reason: null,
  };
}

describe("regressão produção 17/09 — follow-up 'qual delas mais piorou?'", () => {
  it("não reduz pedido de variação a ranking estrutural", () => {
    expect(fastFinancialIR(TEXT, JULY)).toBeNull();
  });

  it("reconhece aumento/piora entre dois meses como comparação", () => {
    const resolved = resolveMultiPeriodsPt(TEXT, new Date("2026-09-17T12:00:00Z"));
    expect(resolved.periods).toHaveLength(2);
    expect(resolved.periods[0]).toMatchObject(JULY);
    expect(resolved.periods[1]).toMatchObject(AUGUST);
    expect(resolved.comparison_intent).toBe(true);
  });

  it("mantém group_by=category e transforma julho/agosto em comparação única", () => {
    const expanded = expandIRForPeriods(
      {
        ...compareIr(),
        version: "financial_query_ir.v2" as const,
        dialogue: { acts: ["followup" as const], topic_id: "t1", inherits_from_topic_id: null },
        queries: [{ ...compareIr().queries[0], depends_on: [] }],
        completeness_targets: [{ id: "q1.direction", query_id: "q1", claim: "direction" as const, required: true }],
      },
      [JULY, AUGUST],
      true,
    );
    expect(expanded.mode).toBe("comparison");
    expect(expanded.ir.period).toMatchObject(AUGUST);
    expect(expanded.ir.comparison_period).toMatchObject(JULY);
    expect(expanded.ir.queries).toHaveLength(1);
    expect(expanded.ir.queries[0]).toMatchObject({ operation: "compare", group_by: ["category"] });
  });

  it("follow-up compila mudança e responde a categoria que mais aumentou, sem repetir rankings", async () => {
    const compile = vi.fn(async () => ({ ir: compareIr(), telemetry: null }));
    const runEngine = vi.fn(async (_tool: string, _args: Record<string, unknown>) => ({
      ok: true,
      duration_ms: 3,
      result: {
        metric: "expense",
        total_a: 20990.08,
        total_b: 13342.37,
        delta_abs: -7647.71,
        delta_pct: -0.3644,
        requested_group_by: "category",
        by_group: [
          { name: "Alimentação", total_a: 840, total_b: 1295.98, delta_abs: 455.98, delta_pct: 0.5428 },
          { name: "Transporte", total_a: 1490.46, total_b: 1345.23, delta_abs: -145.23, delta_pct: -0.0974 },
          { name: "Moradia", total_a: 8655.37, total_b: 3845.71, delta_abs: -4809.66, delta_pct: -0.5557 },
        ],
        comparable: true,
      },
    }));

    const out = await runSemanticTurn({
      text: TEXT,
      acts: ["followup"],
      constraints: { period: true, dimension: false, entity: false },
      period: JULY,
      periods: [JULY, AUGUST],
      comparison_intent: true,
      previous_query: "Quais categorias eu mais gastei nos meses de julho e agosto?",
      topic_state: null,
      max_queries: 4,
      investigation_enabled: true,
      preservation_enforced: true,
      typical_monthly_enabled: true,
      failure_reply: "falha",
      now: new Date("2026-09-17T12:00:00Z"),
    }, {
      compile,
      runEngine,
      loadOptions: vi.fn(async () => []),
      recordStage: vi.fn(),
    });

    expect(compile).toHaveBeenCalledTimes(1);
    expect(runEngine).toHaveBeenCalledWith(
      "compare_periods",
      expect.objectContaining({
        group_by: "category",
        period_a: { from: JULY.from, to: JULY.to },
        period_b: { from: AUGUST.from, to: AUGUST.to },
      }),
      "q1",
    );
    expect(out.turn?.reply).toMatch(/Alimenta[cç][aã]o/i);
    expect(out.turn?.reply).toContain("R$");
    expect(out.turn?.reply).not.toMatch(/Onde mais pesou por categorias/i);
    expect(out.preservation?.compatible).toBe(true);
  });
});
