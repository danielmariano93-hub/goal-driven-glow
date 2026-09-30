/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures de pipeline com dependências parciais */
// Regressão de produção (30/09): "gráfico diário de setembro de transporte no
// Uber" respondeu o texto certo, mas SEM gráfico no WhatsApp e com um gráfico
// de "todos os gastos" no app. Causas: (1) validador sem motor para o grão; (2)
// evidência da série gravada como `null`; (3) app gerando gráfico genérico.
// Aqui o turno percorre o caminho real até o artefato persistido.
import { describe, expect, it } from "vitest";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { buildFinancialReadContract } from "../../supabase/functions/_shared/agent/core/FinancialReadContract";
import { verifyFinancialFulfillment } from "../../supabase/functions/_shared/agent/core/ContractFulfillmentGate";
import { repairSeriesGrainInContract } from "../../supabase/functions/_shared/agent/core/SeriesGrainRepair";
import {
  buildScopedSeries,
  SCOPED_SERIES_ENGINE,
  scopedSeriesExecutedIR,
  scopedSeriesText,
} from "../../supabase/functions/_shared/agent/core/handlers/ScopedSeriesHandler";
import { ensureRequestedArtifact } from "../../supabase/functions/_shared/intelligence/chartFallback";
import { mergeExecutedSeriesEvidence } from "../../supabase/functions/_shared/intelligence/chartTemplates";
import { resolvePeriodPt } from "../../supabase/functions/_shared/analytics/periodResolver";

const NOW = new Date("2026-09-30T11:34:00Z");
const s = (value: string) => ({ value, source: "current_turn" as const, source_span: value });
const ENTRIES = [
  { date: "2026-09-05", amount: 65.94 },
  { date: "2026-09-06", amount: 80.93 },
  { date: "2026-09-19", amount: 81.96 },
];

async function runTurn(text: string, operation: string, groupBy: string[], periodExpr = "setembro") {
  const turn = {
    version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request",
    canonical_request: "gastos com Transporte no Uber", inherit_topic: false, references: [],
    tasks: [{
      kind: "financial_query", family: "financial.query", metric: "expense_amount",
      operation, group_by: groupBy,
      filters: [{ field: "category", entity: s("transporte") }, { field: "merchant", entity: s("Uber") }],
      periods: [s(periodExpr)], limit: null, comparison: null,
    }],
  };
  const bridged = bridgeTurnSpecV3ToRuntime(turn as never, NOW);
  if (!bridged.ok) throw new Error("bridge_failed");
  const contract = repairSeriesGrainInContract(bridged.contract, text); // ConversationAuthority
  const period = resolvePeriodPt(`${text} ${periodExpr}`, NOW)!;
  const compiled = compileFinancialReadFromTurn({
    turn: contract,
    period: { from: period.from, to: period.to, label: period.label },
    comparison_period: null,
  });
  if (!compiled?.ir) throw new Error("compile_failed");
  const out = await runSemanticTurn({
    text, acts: ["read_financial"] as never,
    constraints: { period: true, dimension: false, entity: true },
    period: { from: period.from, to: period.to, label: period.label }, comparison_period: null,
    topic_state: null, max_queries: 1, investigation_enabled: false, now: NOW,
    preservation_enforced: true, typical_monthly_enabled: true, authoritative_contract: true,
    failure_reply: "falha honesta",
  } as never, {
    compile: async () => compiled,
    loadOptions: async () => ["Transporte"],
    recordStage: () => {},
    runEngine: async () => { throw new Error("motor_generico_nao_deveria_rodar"); },
    runTypicalMonthly: async (query: any) => {
      const result = buildScopedSeries(ENTRIES, {
        grain: query.grain, from: query.time.from, to: query.time.to, category_label: "Transporte", merchant: "Uber",
      });
      return { text: scopedSeriesText(result), executed_ir: scopedSeriesExecutedIR(query, result), engine: SCOPED_SERIES_ENGINE, result };
    },
  } as never);
  const fulfillment = verifyFinancialFulfillment({
    contract: buildFinancialReadContract({ turn: contract, requested: out.ir_v3!, grounded_reference: null } as never),
    preservation: out.preservation ?? null,
    grounding: (out as any).grounding ?? null,
  });
  return { out, fulfillment };
}

function fakeSb() {
  const inserted: any[] = [];
  const sb = {
    from: () => ({
      insert: (row: any) => {
        inserted.push(row);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: `art-${inserted.length}` }, error: null }) }) };
      },
    }),
  };
  return { sb, inserted };
}

/** O que AgentCoreV2Entry faz: gravação (aqui com o defeito `null`) + evidência executada. */
async function chartFor(text: string, out: any) {
  const executed = out.turn.toolCalls.map((c: any) => ({ tool_name: c.tool_name, args: c.args, result: c.result, ok: c.ok }));
  const storedWithBug = executed.map((c: any, i: number) => ({
    step_index: i, tool_name: c.tool_name, args: {}, result: null, ok: true, duration_ms: 0, error: null,
  }));
  const { sb, inserted } = fakeSb();
  const artifact = await ensureRequestedArtifact({
    sb: sb as never, user_id: "u", conversation_id: "c", text,
    toolCalls: mergeExecutedSeriesEvidence(storedWithBug, executed) as never,
  });
  return { artifact, inserted };
}

const DAILY = "Nino me traga um gráfico diário do mês de setembro dos gastos que tive com transporte no estabelecimento Uber";

describe("gráfico diário de Transporte no Uber — caminho real até o artefato", () => {
  it.each([
    ["trend", ["day"]],
    ["sum", ["day"]],
    ["trend", []],
    ["sum", []],
    ["value", []],
    ["trend", ["month"]],
  ])("interpretação %s %o → série diária + gráfico diário com o recorte", async (operation, groupBy) => {
    const { out, fulfillment } = await runTurn(DAILY, operation as string, groupBy as string[]);
    expect(out.telemetry.executed_by).toBe("typical_monthly_handler");
    expect(out.engines).toEqual([SCOPED_SERIES_ENGINE]);
    expect(fulfillment.violations).toEqual([]);
    expect(out.turn?.reply).toContain("Transporte no Uber, dia a dia");

    const { artifact, inserted } = await chartFor(DAILY, out);
    expect(artifact?.artifact_id).toBe("art-1");
    expect(artifact?.toolCall.tool_name).toBe("generate_daily_series_chart_artifact");
    expect(inserted).toHaveLength(1);
    const payload = inserted[0].payload;
    expect(payload.title).toBe("Gastos dia a dia · Transporte no Uber");
    expect(payload.chart.x_labels).toHaveLength(30);
    expect(payload.chart.x_labels[0]).toBe("01/09");
    expect((payload.chart.series[0].data as number[]).reduce((a, b) => a + b, 0)).toBeCloseTo(228.83, 2);
    expect(payload.provenance.period).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("follow-up \"Me traga isso em gráfico diário agora\" gera o gráfico do mesmo recorte", async () => {
    const text = "Me traga isso em gráfico diário agora";
    const { out, fulfillment } = await runTurn(text, "trend", ["month"]);
    expect(fulfillment.violations).toEqual([]);
    const { artifact, inserted } = await chartFor(text, out);
    expect(artifact?.artifact_id).toBeTruthy();
    expect(inserted[0].payload.title).toBe("Gastos dia a dia · Transporte no Uber");
  });

  it("gráfico semanal usa o template semanal com os mesmos dados", async () => {
    const text = "gráfico semanal de setembro dos gastos com transporte no Uber";
    const { out, fulfillment } = await runTurn(text, "sum", []);
    expect(fulfillment.violations).toEqual([]);
    expect(out.turn?.reply).toContain("semana a semana");
    const { artifact, inserted } = await chartFor(text, out);
    expect(artifact?.toolCall.tool_name).toBe("generate_weekly_series_chart_artifact");
    expect(inserted[0].payload.title).toBe("Gastos semana a semana · Transporte no Uber");
    expect(inserted[0].payload.chart.x_labels).toHaveLength(5);
  });

  it("pedido com recorte sem série nunca vira gráfico genérico de todos os gastos", async () => {
    const { sb, inserted } = fakeSb();
    const artifact = await ensureRequestedArtifact({
      sb: sb as never, user_id: "u", conversation_id: "c",
      text: "me mostra um gráfico dos meus gastos com Uber",
      toolCalls: [{
        step_index: 0, tool_name: "merchant_profile", args: { merchant: "Uber" },
        result: { merchant: "Uber", total: 697.01 }, ok: true, duration_ms: 0, error: null,
      }],
    });
    expect(artifact?.artifact_id).toBeNull();
    expect(artifact?.toolCall.error).toBe("scoped_chart_evidence_unavailable");
    expect(inserted).toHaveLength(0);
  });
});
