/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures de pipeline com dependências parciais */
// Regressão de produção (30/09): "Nino me traga um gráfico diário do mês de
// setembro dos gastos que tive com transporte no estabelecimento Uber" terminou
// em `semantic_unsupported:unsupported_required_query:q1` — o validador do
// plano não tinha motor mapeado para a série diária e o turno nem chegava ao
// handler. Aqui o turno percorre o caminho REAL: V3 → contrato → IR →
// validador → aspecto → handler diário → gráfico.
import { describe, expect, it } from "vitest";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { validateFinancialPlan } from "../../supabase/functions/_shared/agent/core/FinancialPlanValidator";
import { normalizeToV2 } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";
import { buildFinancialReadContract } from "../../supabase/functions/_shared/agent/core/FinancialReadContract";
import { verifyFinancialFulfillment } from "../../supabase/functions/_shared/agent/core/ContractFulfillmentGate";
import { repairDailyGrain, repairDailyGrainInContract, requestsDailySeries } from "../../supabase/functions/_shared/agent/core/DailyGrainRepair";
import {
  buildDailySeries,
  dailySeriesExecutedIR,
  dailySpendingSeriesText,
} from "../../supabase/functions/_shared/agent/core/handlers/DailySeriesHandler";
import { ensureRequestedArtifact } from "../../supabase/functions/_shared/intelligence/chartFallback";
import { resolvePeriodPt } from "../../supabase/functions/_shared/analytics/periodResolver";

const TEXT = "Nino me traga um gráfico diário do mês de setembro dos gastos que tive com transporte no estabelecimento Uber";
const NOW = new Date("2026-09-30T10:56:00Z");
const s = (value: string) => ({ value, source: "current_turn" as const, source_span: value });

// As formas que a interpretação pode devolver para a mesma frase.
const INTERPRETATIONS = [
  { operation: "trend", group_by: ["day"] },
  { operation: "sum", group_by: ["day"] },
  { operation: "trend", group_by: [] },
  { operation: "sum", group_by: [] },
  { operation: "value", group_by: [] },
] as const;

function compiledFor(operation: string, groupBy: readonly string[]) {
  const turn = {
    version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request",
    canonical_request: "gráfico diário de gastos com Transporte no Uber em setembro",
    inherit_topic: false, references: [],
    tasks: [{
      kind: "financial_query", family: "financial.query", metric: "expense_amount",
      operation, group_by: [...groupBy],
      filters: [{ field: "category", entity: s("transporte") }, { field: "merchant", entity: s("Uber") }],
      periods: [s("setembro")], limit: null, comparison: null,
    }],
  };
  const bridged = bridgeTurnSpecV3ToRuntime(turn as never, NOW);
  if (!bridged.ok) throw new Error("bridge_failed");
  // Igual à ConversationAuthority em produção.
  const contract = repairDailyGrainInContract(bridged.contract, TEXT);
  const period = resolvePeriodPt(TEXT, NOW)!;
  const compiled = compileFinancialReadFromTurn({
    turn: contract,
    period: { from: period.from, to: period.to, label: period.label },
    comparison_period: null,
  });
  if (!compiled?.ir) throw new Error("compile_failed");
  return { compiled, period, contract };
}

const ENTRIES = [
  { date: "2026-09-02", amount: 23.9 },
  { date: "2026-09-10", amount: 55 },
  { date: "2026-09-21", amount: 31.45 },
];

describe("gráfico diário de Transporte no Uber — caminho real", () => {
  it("o validador do plano aceita a série diária (antes: unsupported_required_query)", () => {
    const { compiled } = compiledFor("trend", ["day"]);
    const validation = validateFinancialPlan(normalizeToV2(compiled.ir as never, { acts: [], topic_id: "t" } as never));
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(validation.mapped.map((m) => m.tool)).toEqual(["spending_timeseries_daily_scoped"]);
  });

  it.each(INTERPRETATIONS)("interpretação %o chega ao handler diário com os dois filtros e setembro inteiro", async ({ operation, group_by }) => {
    const { compiled, period, contract } = compiledFor(operation, group_by);
    let received: any = null;
    const out = await runSemanticTurn({
      text: TEXT,
      acts: ["read_financial"] as never,
      constraints: { period: true, dimension: false, entity: true },
      period: { from: period.from, to: period.to, label: period.label },
      comparison_period: null,
      topic_state: null,
      max_queries: 1,
      investigation_enabled: false,
      now: NOW,
      preservation_enforced: true,
      typical_monthly_enabled: true,
      authoritative_contract: true,
      failure_reply: "falha honesta",
    } as never, {
      compile: async () => compiled,
      loadOptions: async () => ["Transporte"],
      recordStage: () => {},
      runEngine: async () => { throw new Error("motor_generico_nao_deveria_rodar"); },
      runTypicalMonthly: async (query: any) => {
        received = query;
        const result = buildDailySeries(ENTRIES, {
          from: query.time.from, to: query.time.to, category_label: "Transporte", merchant: "Uber",
        });
        return {
          text: dailySpendingSeriesText(result),
          executed_ir: dailySeriesExecutedIR(query, result),
          engine: "spending_timeseries_daily_scoped",
          result,
        };
      },
    } as never);

    expect(out.status).toBe("executable");
    expect(out.telemetry.executed_by).toBe("typical_monthly_handler");
    expect(out.engines).toEqual(["spending_timeseries_daily_scoped"]);
    expect(received).toMatchObject({ grain: "day", time: { aspect: "trend", from: "2026-09-01", to: "2026-09-30" } });
    expect(received.filters.map((f: any) => f.field).sort()).toEqual(["category", "merchant"]);
    expect(out.turn?.reply).toContain("dia a dia");
    expect(out.turn?.reply).not.toBe("falha honesta");
    expect(out.preservation?.compatible).toBe(true);

    // Portão de cumprimento de AgentCoreV2: pedido canônico == IR == executado.
    const fulfillment = verifyFinancialFulfillment({
      contract: buildFinancialReadContract({ turn: contract, requested: out.ir_v3!, grounded_reference: null } as never),
      preservation: out.preservation ?? null,
      grounding: (out as any).grounding ?? null,
    });
    expect(fulfillment.violations).toEqual([]);

    // O gráfico sai da MESMA evidência, uma barra por dia de setembro.
    let inserted: any = null;
    const sb = {
      from: () => ({
        insert: (row: any) => {
          inserted = row;
          return { select: () => ({ maybeSingle: async () => ({ data: { id: "art-1" }, error: null }) }) };
        },
      }),
    };
    const artifact = await ensureRequestedArtifact({
      sb: sb as never, user_id: "u", conversation_id: "c", text: TEXT,
      toolCalls: out.turn!.toolCalls as never,
    });
    expect(artifact?.artifact_id).toBe("art-1");
    expect(artifact?.toolCall.tool_name).toBe("generate_daily_series_chart_artifact");
    expect(inserted.payload.title).toBe("Gastos dia a dia · Transporte no Uber");
    expect(inserted.payload.chart.x_labels).toHaveLength(30);
  });
});

describe("reparo do grão diário é estreito", () => {
  it("só dispara com pedido explícito de série diária", () => {
    expect(requestsDailySeries(TEXT)).toBe(true);
    expect(requestsDailySeries("quero ver dia a dia meus gastos no Uber")).toBe(true);
    expect(requestsDailySeries("qual minha média diária com Uber?")).toBe(false);
    expect(requestsDailySeries("quanto gasto por dia em média com Uber?")).toBe(false);
    expect(requestsDailySeries("quanto gastei com Uber em setembro?")).toBe(false);
  });

  it("não mexe em ranking, agrupamento por categoria ou filtro de conta", () => {
    const base = {
      version: "financial_query_ir.v2", intent: "lookup", period: { from: "2026-09-01", to: "2026-09-30", label: "setembro" },
      comparison_period: null, assumptions: [], needs_clarification: [], completeness_targets: [], source: "compiler",
      unsupported_reason: null,
    };
    const q = (over: Record<string, unknown>) => ({
      ...base, queries: [{ id: "q1", metric: "expense_amount", operation: "sum", group_by: [], filters: [], limit: null, depends_on: [], ...over }],
    });
    expect(repairDailyGrain(q({ operation: "rank", group_by: ["merchant"] }) as never, TEXT).repaired).toBe(false);
    expect(repairDailyGrain(q({ group_by: ["category"] }) as never, TEXT).repaired).toBe(false);
    expect(repairDailyGrain(q({ filters: [{ field: "account", op: "eq", value: "Nubank" }] }) as never, TEXT).repaired).toBe(false);
    const ok = repairDailyGrain(q({ filters: [{ field: "merchant", op: "eq", value: "Uber" }] }) as never, TEXT);
    expect(ok.repaired).toBe(true);
    expect(ok.ir.queries[0]).toMatchObject({ operation: "trend", group_by: ["day"] });
  });
});
