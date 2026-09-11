// `nino_semantic_ir.v4` — integração no pipeline semântico.
//
// Aqui provamos as três garantias que faltavam em produção:
// 1. o aspecto temporal do turno desce para cada query (hábito != mês corrente);
// 2. o `executed_ir` é derivado do resultado REAL da engine;
// 3. filtro perdido pela engine BLOQUEIA a resposta (fail-closed), em vez de
//    virar um número de outro recorte apresentado com confiança.
import { describe, expect, it } from "vitest";
import { applyTurnAspect } from "../../supabase/functions/_shared/agent/core/SemanticAspectOverlay";
import { executedIRFrom } from "../../supabase/functions/_shared/agent/core/ExecutedIRBridge";
import { normalizeToV3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { PRESERVATION_FAILURE_REPLY } from "../../supabase/functions/_shared/agent/core/SemanticPreservation";

const NOW = new Date("2026-03-12T12:00:00Z");
const PERIOD = { from: "2026-03-01", to: "2026-03-12", label: "este mês até hoje" };

function irV2(overrides?: Partial<Record<string, unknown>>) {
  return {
    version: "financial_query_ir.v2",
    intent: "lookup",
    queries: [{
      id: "q1",
      metric: "expense_amount",
      operation: "value",
      filters: [{ field: "category", op: "eq", value: "Alimentação" }],
      group_by: [],
      limit: null,
      depends_on: [],
    }],
    period: PERIOD,
    comparison_period: null,
    assumptions: [],
    needs_clarification: [],
    completeness_targets: [],
    source: "compiler",
    unsupported_reason: null,
    ...(overrides ?? {}),
  };
}

describe("applyTurnAspect — o aspecto do turno desce para a query", () => {
  it("hábito vira janela de meses fechados com estatística típica", () => {
    const v3 = normalizeToV3(irV2() as never, { today: "2026-03-12" });
    const out = applyTurnAspect(v3, "quanto eu gasto com alimentação por mês?", NOW);
    expect(out.applied).toBe(true);
    const q = out.ir.queries[0];
    expect(q.time.aspect).toBe("habitual");
    expect(q.time.exclude_partial).toBe(true);
    expect(q.time.from).toBe("2025-09-01");
    expect(q.time.to).toBe("2026-02-28");
    expect(q.grain).toBe("month");
    expect(q.reduce).toBe("typical");
    expect(out.ir.assumptions.join(" ")).toContain("meses completos");
  });

  it("recorte pontual não é transformado em hábito", () => {
    const v3 = normalizeToV3(irV2() as never, { today: "2026-03-12" });
    const out = applyTurnAspect(v3, "quanto gastei com alimentação?", NOW);
    expect(out.applied).toBe(false);
    expect(out.ir.queries[0].time.from).toBe("2026-03-01");
  });

  it("métrica de estado (saldo) nunca recebe aspecto de fluxo", () => {
    const base = irV2({
      queries: [{
        id: "q1", metric: "balance", operation: "value",
        filters: [], group_by: [], limit: null, depends_on: [],
      }],
    });
    const out = applyTurnAspect(normalizeToV3(base as never, { today: "2026-03-12" }), "quanto eu gasto por mês?", NOW);
    expect(out.ir.queries[0].time.aspect).toBe("point_in_time");
  });
});

describe("executedIRFrom — verdade do que a engine rodou", () => {
  const requested = normalizeToV3(irV2() as never, { today: "2026-03-12" }).queries[0];

  it("deriva janela e filtros do spending_report", () => {
    const executed = executedIRFrom(requested, {
      kind: "spending_report", metric: "expense", view: "total", group_by: "category",
      period: { from: "2026-03-01", to: "2026-03-12", days: 12 },
      filters: { category: "Alimentação", card: null, account: null, payment_method: null },
    });
    expect(executed?.metric).toBe("expense_amount");
    expect(executed?.filters).toEqual([{ field: "category", op: "eq", value: "Alimentação" }]);
    expect(executed?.time.from).toBe("2026-03-01");
  });

  it("filtro perdido pela engine aparece no executed_ir", () => {
    const executed = executedIRFrom(requested, {
      kind: "spending_report", metric: "expense", view: "total", group_by: "category",
      period: { from: "2026-03-01", to: "2026-03-12", days: 12 },
      filters: { category: null, card: null, account: null, payment_method: null },
    });
    expect(executed?.filters).toEqual([]);
  });

  it("resultado sem estrutura nem declaração devolve null (fail-closed)", () => {
    expect(executedIRFrom(requested, { kind: "financial_snapshot", total: 1234 })).toBeNull();
  });
});

const DEPS_BASE = {
  compile: async () => ({ ir: irV2() as never, telemetry: null }),
  loadOptions: async () => ["Alimentação", "Transporte"],
  recordStage: () => {},
};

function input(overrides?: Record<string, unknown>) {
  return {
    text: "quanto gastei com alimentação esse mês?",
    acts: ["read_financial"] as never,
    constraints: { period: true, dimension: false, entity: true },
    period: PERIOD,
    comparison_period: null,
    topic_state: null,
    max_queries: 1,
    investigation_enabled: false,
    now: NOW,
    failure_reply: "falha honesta",
    ...(overrides ?? {}),
  };
}

describe("runSemanticTurn — preservação bloqueia resposta de outro recorte", () => {
  const spending = (category: string | null) => ({
    kind: "spending_report", metric: "expense", view: "total", group_by: "category",
    period: { from: "2026-03-01", to: "2026-03-12", days: 12 },
    filters: { category, card: null, account: null, payment_method: null },
    total_metric: 812.4, totals: { expense: 812.4, income: 0, net: -812.4 },
    categories: [], breakdown: [], top: [], daily: [], transactions_count: 9,
  });

  it("com filtro preservado a resposta sai normalmente", async () => {
    const out = await runSemanticTurn(input({ preservation_enforced: true }) as never, {
      ...DEPS_BASE,
      runEngine: async () => ({ ok: true, result: spending("Alimentação"), duration_ms: 5 }),
    } as never);
    expect(out.preservation?.compatible).toBe(true);
    expect(out.turn?.reply).not.toBe(PRESERVATION_FAILURE_REPLY);
  });

  it("filtro de categoria perdido pela engine bloqueia com resposta honesta", async () => {
    const out = await runSemanticTurn(input({ preservation_enforced: true }) as never, {
      ...DEPS_BASE,
      runEngine: async () => ({ ok: true, result: spending(null), duration_ms: 5 }),
    } as never);
    expect(out.preservation?.compatible).toBe(false);
    expect(out.turn?.reply).toBe(PRESERVATION_FAILURE_REPLY);
    expect(out.telemetry.executed_by).toBe("preservation_blocked");
    expect(out.errors).toContain("preservation_mismatch");
  });

  it("com a flag desligada o mismatch é telemetria, não bloqueio", async () => {
    const out = await runSemanticTurn(input({ preservation_enforced: false }) as never, {
      ...DEPS_BASE,
      runEngine: async () => ({ ok: true, result: spending(null), duration_ms: 5 }),
    } as never);
    expect(out.preservation?.compatible).toBe(false);
    expect(out.turn?.reply).toBeTruthy();
    expect(out.telemetry.executed_by).not.toBe("preservation_blocked");
  });
});

describe("runSemanticTurn — handler de gasto típico mensal", () => {
  it("pergunta de hábito é respondida pelo handler determinístico", async () => {
    const out = await runSemanticTurn(
      input({ text: "quanto eu gasto com alimentação por mês?", typical_monthly_enabled: true, preservation_enforced: true }) as never,
      {
        ...DEPS_BASE,
        runEngine: async () => {
          throw new Error("engine_nao_deveria_rodar");
        },
        runTypicalMonthly: async (query: never) => ({
          text: "Seu gasto típico com Alimentação é de R$ 1.200 por mês.",
          engine: "typical_monthly_expense",
          result: { headline: 1200 },
          executed_ir: {
            metric: "expense_amount",
            filters: (query as { filters: unknown[] }).filters,
            time: {
              aspect: "habitual", from: "2025-09-01", to: "2026-02-28", n: 6, exclude_partial: true,
            },
            grain: "month", reduce: "typical", group_by: [], partial: false,
          },
        }),
      } as never,
    );
    expect(out.engines).toEqual(["typical_monthly_expense"]);
    expect(out.telemetry.executed_by).toBe("typical_monthly_handler");
    expect(out.turn?.reply).toContain("por mês");
    expect(out.preservation?.compatible).toBe(true);
  });
});
