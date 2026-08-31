// Regressão de RUNTIME do caminho analítico novo.
//
// O bug real: `assess_goal_performance` pedia a coluna inexistente
// `transfer_direction`, o PostgREST derrubava a leitura, `CompositeAnalysis`
// devolvia null e o fluxo antigo respondia outra coisa — mesma resposta de
// sempre. Estes testes cobrem o caminho até o contrato do banco.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  transactionColumns, collectTransactionSelects, findInvalidTransactionColumns,
} from "../../scripts/check-tx-selects.mjs";
import { computeGoalPerformance } from "../../supabase/functions/_shared/agent/goalPerformanceTool";
import { resolveAnalyticalPlan } from "../../supabase/functions/_shared/agent/core/AnalyticalQueryPlanner";
import { computeGoalPerformanceAssessment } from "../lib/engine/goalPerformanceAssessment";
import { reportingCompetenceDate } from "../lib/engine/facts";
import { runAnalysisGates } from "../../supabase/functions/_shared/agent/core/AnalysisGates";
import { resolveInterpretation } from "../../supabase/functions/_shared/agent/core/InterpretationResolver";
import { formatGoalPerformance } from "../../supabase/functions/_shared/agent/core/DeterministicAnswers";

const SCHEMA_COLUMNS = transactionColumns();

// ---------------------------------------------------------------- guarda CI
describe("tx_select_guard.v1", () => {
  it("não existe SELECT de transactions com coluna fora do schema", () => {
    expect(findInvalidTransactionColumns()).toEqual([]);
  });

  it("encontra selects reais para auditar", () => {
    expect(collectTransactionSelects().length).toBeGreaterThan(5);
  });

  it("acusaria a coluna inexistente transfer_direction", () => {
    const bad = findInvalidTransactionColumns(
      [{ file: "fake.ts", columns: ["id", "amount", "transfer_direction"] }],
      SCHEMA_COLUMNS,
    );
    expect(bad).toEqual([{ file: "fake.ts", column: "transfer_direction" }]);
  });
});

// -------------------------------------------------- cliente falso do banco
type Query = { table: string; columns: string[]; filters: string[] };

function fakeSupabase(opts: {
  goals: any[]; categories: any[]; txs: any[]; queries: Query[];
}) {
  const build = (table: string) => {
    const q: Query = { table, columns: [], filters: [] };
    let rows: any[] = table === "category_spending_goals"
      ? opts.goals
      : table === "categories"
      ? opts.categories
      : table === "transactions"
      ? opts.txs
      : [];
    const api: any = {
      select(cols: string) {
        q.columns = String(cols).split(",").map((c) => c.trim()).filter(Boolean);
        if (table === "transactions") {
          // Contrato real: coluna inexistente derruba a query (PostgREST).
          const invalid = q.columns.filter((c) => !SCHEMA_COLUMNS.has(c));
          if (invalid.length) {
            api.__error = { message: `column transactions.${invalid[0]} does not exist` };
          }
        }
        opts.queries.push(q);
        return api;
      },
      eq(col: string, val: unknown) { q.filters.push(`eq:${col}=${val}`); return api; },
      is(col: string, val: unknown) { q.filters.push(`is:${col}=${val}`); return api; },
      or(expr: string) { q.filters.push(`or:${expr}`); return api; },
      gte(col: string, v: string) { q.filters.push(`gte:${col}=${v}`); rows = rows.filter((r) => String(r[col]) >= v); return api; },
      lte(col: string, v: string) { q.filters.push(`lte:${col}=${v}`); rows = rows.filter((r) => String(r[col]) <= v); return api; },
      order() { return api; },
      range() { return Promise.resolve(api.__error ? { data: null, error: api.__error } : { data: rows, error: null }); },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(res: any, rej: any) {
        return Promise.resolve(api.__error ? { data: null, error: api.__error } : { data: rows, error: null }).then(res, rej);
      },
      __error: null as any,
    };
    return api;
  };
  return { from: (table: string) => build(table) };
}

const GOAL = {
  id: "g1", user_id: "u1", category_id: "c1", mode: "fixed", fixed_limit: 800, computed_limit: 800,
  frequency: "monthly", period_type: "monthly_recurring", start_date: "2026-08-01",
  end_date: null, status: "active", timezone: "America/Sao_Paulo",
};

function tx(over: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(), user_id: "u1", account_id: "a1", category_id: "c1",
    type: "expense", status: "confirmed", amount: 100, occurred_at: "2026-08-05",
    description: "compra", transfer_group_id: null, payment_method: "account",
    credit_card_id: null, competence_date: null, settles_card_id: null,
    movement_kind: "transaction", refund_of_transaction_id: null,
    posted_at: null, posted_at_source: null, ...over,
  };
}

describe("assess_goal_performance: contrato real do banco", () => {
  it("carrega transações sem coluna inventada e devolve avaliação", async () => {
    const queries: Query[] = [];
    const sb = fakeSupabase({
      goals: [GOAL],
      categories: [{ id: "c1", name: "Alimentação" }],
      txs: [tx({ amount: 300, occurred_at: "2026-08-05" }), tx({ amount: 400, occurred_at: "2026-07-05" })],
      queries,
    });

    const result = await computeGoalPerformance(sb as any, "u1");
    expect(result.formula_version).toBe("goal_performance_assessment.v1");
    expect(result.categories.length).toBe(1);
    expect(result.categories[0].category_name).toBe("Alimentação");

    const txQuery = queries.find((q) => q.table === "transactions")!;
    expect(txQuery.columns).not.toContain("transfer_direction");
    for (const col of txQuery.columns) expect(SCHEMA_COLUMNS.has(col)).toBe(true);
  });

  it("carrega o contrato completo exigido por isRealMonthlyMovement", async () => {
    const queries: Query[] = [];
    const sb = fakeSupabase({ goals: [GOAL], categories: [{ id: "c1", name: "Alimentação" }], txs: [tx({})], queries });
    await computeGoalPerformance(sb as any, "u1");
    const cols = queries.find((q) => q.table === "transactions")!.columns;
    for (const required of [
      "transfer_group_id", "settles_card_id", "movement_kind", "competence_date",
      "posted_at", "posted_at_source", "refund_of_transaction_id", "credit_card_id", "payment_method",
    ]) expect(cols).toContain(required);
  });

  it("inclui categorias globais (user_id IS NULL), não só as pessoais", async () => {
    const queries: Query[] = [];
    const sb = fakeSupabase({ goals: [GOAL], categories: [{ id: "c1", name: "Alimentação" }], txs: [tx({})], queries });
    await computeGoalPerformance(sb as any, "u1");
    const catQuery = queries.find((q) => q.table === "categories")!;
    expect(catQuery.filters.some((f) => f.includes("user_id.is.null"))).toBe(true);
  });

  it("a pergunta exata do usuário casa com o plano analítico e chama o motor", () => {
    const plan = resolveAnalyticalPlan({
      text: "Me traga um overview das minhas metas, diga se eu atingi ou ultrapassei e compare essas mesmas categorias com o mesmo período do mês passado",
      now: new Date("2026-08-31T12:00:00"),
    });
    expect(plan).not.toBeNull();
    expect(plan!.engines[0].tool).toBe("assess_goal_performance");
  });

  it("golden temporal: mês atual permanece agosto e comparação permanece julho", () => {
    const text = "Me traga um overview das minhas metas no mês atual, diga se eu atingi ou ultrapassei e compare essas mesmas categorias com o mesmo período do mês passado";
    const turn = resolveAnalyticalPlan({ text, now: new Date("2026-08-31T12:00:00Z") });
    expect(turn?.periods.current).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    expect(turn?.periods.comparison).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(turn?.periods.comparison_basis).toBe("calendar_previous_month");
    expect(turn?.engines[0].args).toMatchObject({
      current_from: "2026-08-01", current_to: "2026-08-31",
      comparison_from: "2026-07-01", comparison_to: "2026-07-31",
    });
  });
});

// -------------------------------------------------- competência de relatório
describe("reporting_competence.v1", () => {
  it("cartão usa competência da fatura; conta usa data econômica", () => {
    expect(reportingCompetenceDate({
      payment_method: "credit_card", credit_card_id: "cc1",
      competence_date: "2026-08-01", occurred_at: "2026-07-30",
    } as any)).toBe("2026-08-01");
    expect(reportingCompetenceDate({
      payment_method: "account", credit_card_id: null,
      competence_date: null, occurred_at: "2026-07-30",
    } as any)).toBe("2026-07-30");
  });

  it("compra de 30/07 na fatura de agosto conta em agosto e não em julho", () => {
    const cardBuy = tx({
      amount: 250, occurred_at: "2026-07-30", competence_date: "2026-08-01",
      payment_method: "credit_card", credit_card_id: "cc1",
    });
    const assessment = computeGoalPerformanceAssessment({
      goals: [GOAL] as any,
      txs: [cardBuy, tx({ amount: 100, occurred_at: "2026-08-10" })] as any,
      categoryNameById: { c1: "Alimentação" },
      today: new Date("2026-08-20T12:00:00"),
      comparison: { from: "2026-07-01", to: "2026-07-20" },
    });
    const cat = assessment.categories[0];
    expect(cat.goal.actual).toBe(350);      // 250 (fatura de agosto) + 100
    expect(cat.historical.current).toBe(350);
    expect(cat.historical.previous).toBe(0); // nada em julho por competência
  });
});

// ------------------------------------- proibição de fallback semântico
describe("nino_composite.v1: sem fallback semântico silencioso", () => {
  const composite = readFileSync("supabase/functions/_shared/agent/core/CompositeAnalysis.ts", "utf8");
  const core = readFileSync("supabase/functions/_shared/agent/core/AgentCore.ts", "utf8");

  it("o desfecho do motor é explícito (answered/failed/not_applicable)", () => {
    for (const token of ["not_applicable", "answered", "failed", "COMPOSITE_FAILURE_REPLY"]) {
      expect(composite).toContain(token);
    }
    expect(composite).not.toContain("return null");
  });

  it("emite telemetria de caminho e motivo do fallback", () => {
    for (const token of [
      "composite_plan_matched", "goal_performance_tool_started",
      "goal_performance_tool_failed", "fallback_reason", "final_path",
    ]) expect(composite).toContain(token);
  });

  it("AgentCore responde honestamente quando o motor reconhecido falha", () => {
    expect(core).toContain("analyticalFailed");
    expect(core).toContain("analyticalFailed?.reply");
    expect(core).toContain("!analyticalFailed && !protectedBlock && mandatoryTools.length > 1");
  });
});

// -------------------------------------- golden E2E do caminho analítico novo
describe("golden: pergunta composta com escopo herdado", () => {
  it("plano → motor → renderer traz todas as metas, cruzamento e conclusão", async () => {
    const { runCompositeAnalysis } = await import(
      "../../supabase/functions/_shared/agent/core/CompositeAnalysis"
    );
    const goals = [
      { ...GOAL, id: "g1", category_id: "c1" },
      { ...GOAL, id: "g2", category_id: "c2", fixed_limit: 500, computed_limit: 500 },
    ];
    const sb = fakeSupabase({
      goals,
      categories: [{ id: "c1", name: "Alimentação" }, { id: "c2", name: "Lazer" }],
      txs: [
        tx({ amount: 300, occurred_at: "2026-08-05", category_id: "c1" }),
        tx({ amount: 700, occurred_at: "2026-07-05", category_id: "c1" }),
        tx({ amount: 200, occurred_at: "2026-08-06", category_id: "c2" }),
      ],
      queries: [],
    });

    const out = await runCompositeAnalysis(sb as any, {
      user_id: "u1",
      conversation_id: "conv1",
      text: "Comparando essas categorias com o mesmo período do mês anterior, eu melhorei ou piorei?",
      previous_scope: {
        entity_type: "category", selection: "explicit_ids",
        entity_ids: ["c1", "c2"], entity_labels: ["Alimentação", "Lazer"],
        aggregate_scope: "scoped_entities", source: "engine_resolved", locked: true,
      } as any,
      turn_period: { from: "2026-08-01", to: "2026-08-31" },
      now: new Date("2026-08-20T12:00:00Z"),
    });

    expect(out.status).toBe("answered");
    if (out.status !== "answered") return;
    expect(out.reply).toContain("Alimentação");
    expect(out.reply).toContain("Lazer");
    expect(out.scope.entity_ids).toEqual(["c1", "c2"]);
    expect(out.scope.aggregate_scope).toBe("scoped_entities");
    expect(out.completeness.status).toBe("complete");
    expect(out.gates.every((g) => g.ok)).toBe(true);
    expect(out.toolCalls[0].tool_name).toBe("assess_goal_performance");
  });
});

describe("golden P0: uma categoria acima, três abaixo", () => {
  it("responde o agregado primeiro e mantém contagens, itens e soma coerentes", () => {
    const categories = [
      { name: "Transporte", current: 1200, previous: 900 },
      { name: "Lazer", current: 700, previous: 1000 },
      { name: "Assinaturas", current: 800, previous: 1000 },
      { name: "Alimentação", current: 900, previous: 1000 },
    ];
    const goals = categories.map((c, i) => ({ ...GOAL, id: `g${i}`, category_id: `c${i}`, computed_limit: 500, fixed_limit: 500 }));
    const txs = categories.flatMap((c, i) => [
      tx({ id: `cur${i}`, category_id: `c${i}`, amount: c.current, occurred_at: "2026-08-10" }),
      tx({ id: `prev${i}`, category_id: `c${i}`, amount: c.previous, occurred_at: "2026-07-10" }),
    ]);
    const out = computeGoalPerformanceAssessment({
      goals: goals as any,
      txs: txs as any,
      categoryNameById: Object.fromEntries(categories.map((c, i) => [`c${i}`, c.name])),
      today: new Date("2026-08-20T12:00:00"),
      current: { from: "2026-08-01", to: "2026-08-20" },
      comparison: { from: "2026-07-01", to: "2026-07-20" },
      comparison_basis: "calendar_previous_month",
    });
    expect(out.conclusions.above_count).toBe(1);
    expect(out.conclusions.below_count).toBe(3);
    expect(out.aggregate.direction).toBe("below");
    const interpretation = resolveInterpretation(out);
    const reply = formatGoalPerformance(out, interpretation);
    expect(reply.startsWith("Sim.")).toBe(true);
    expect(reply).toContain("Transporte");
    expect(reply.split("\u00a0").join(" ")).toContain("R$ 300,00 mais");
    expect(reply.match(/menos que no período anterior/g)).toHaveLength(3);
    const gates = runAnalysisGates({
      assessment: out,
      scope: { entity_type: "category", selection: "explicit_ids", entity_ids: goals.map((g) => g.category_id), entity_labels: categories.map((c) => c.name), aggregate_scope: "scoped_entities", source: "engine_resolved", locked: true },
      requirements: [], comparison_requested: true, expected_entity_count: 4,
      expected_current_period: { from: "2026-08-01", to: "2026-08-20" },
      expected_comparison_period: { from: "2026-07-01", to: "2026-07-20" },
      expected_comparison_basis: "calendar_previous_month",
    });
    expect(gates.filter((g) => !g.ok)).toEqual([]);
  });
});

describe("ciclos de meta heterogêneos", () => {
  it("sinaliza custom incompatível sem forçar igualdade artificial", () => {
    const custom = {
      ...GOAL, id: "custom", period_type: "custom", frequency: "custom",
      start_date: "2026-08-05", end_date: "2026-09-03",
    };
    const out = computeGoalPerformanceAssessment({
      goals: [custom] as any,
      txs: [tx({ amount: 200, occurred_at: "2026-08-06" })] as any,
      categoryNameById: { c1: "Alimentação" },
      today: new Date("2026-08-20T12:00:00Z"),
      current: { from: "2026-08-01", to: "2026-08-20" },
      comparison: { from: "2026-07-01", to: "2026-07-20" },
    });
    expect(out.categories[0].period_compatibility).toBe("incompatible");
    expect(out.categories[0].goal_period).toMatchObject({ from: "2026-08-05", to: "2026-08-20" });
    const gates = runAnalysisGates({
      assessment: out,
      scope: { entity_type: "category", selection: "explicit_ids", entity_ids: ["c1"], entity_labels: ["Alimentação"], aggregate_scope: "scoped_entities", source: "engine_resolved", locked: true },
      requirements: [], comparison_requested: true, expected_entity_count: 1,
      expected_current_period: { from: "2026-08-01", to: "2026-08-20" },
      expected_comparison_period: { from: "2026-07-01", to: "2026-07-20" },
      expected_comparison_basis: "calendar_previous_month",
    });
    expect(gates.filter((g) => !g.ok)).toEqual([]);
    expect(formatGoalPerformance(out, resolveInterpretation(out))).toContain("diferente do recorte comparado");
  });
});
