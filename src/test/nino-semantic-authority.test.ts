// `nino_semantic_ir.v4` — contrato composicional, aspecto temporal e o gate
// único de preservação requested-vs-executed.
//
// Causa-raiz coberta aqui: "quanto eu gasto com alimentação por mês?" era
// compilado igual a "quanto gastei com alimentação?" e respondido com o parcial
// do mês corrente (ou pior, com o agregado global do snapshot).
import { describe, expect, it } from "vitest";
import {
  normalizeToV3, validateFinancialIRv3, isTypicalMonthlyShape,
  type FinancialQueryIRv3, type FinancialQueryV3,
} from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import {
  requestedSubsumesExecuted, planPreservation, allowedClaimDomains,
  type ExecutedIR,
} from "../../supabase/functions/_shared/agent/core/SemanticPreservation";
import {
  resolveTimeAspectPt, lastCompleteMonths, HABITUAL_WINDOW_MONTHS,
} from "../../supabase/functions/_shared/analytics/periodResolver";
import {
  typicalMonthlyPolicy, monthsInWindow, median, mean,
  typicalMonthlyExecutedIR,
} from "../../supabase/functions/_shared/agent/core/handlers/TypicalMonthlyHandler";

const NOW = new Date("2026-09-11T12:00:00Z");

function habitualQuery(overrides: Partial<FinancialQueryV3> = {}): FinancialQueryV3 {
  const w = lastCompleteMonths(6, NOW);
  return {
    id: "q1",
    metric: "expense_amount",
    filters: [{ field: "category", op: "eq", value: "Alimentação" }],
    time: { aspect: "habitual", from: w.from, to: w.to, n: 6, exclude_partial: true, label: "últimos 6 meses completos" },
    grain: "month",
    reduce: "typical",
    group_by: [],
    limit: null,
    depends_on: [],
    legacy_operation: null,
    ...overrides,
  };
}

function ir(queries: FinancialQueryV3[]): FinancialQueryIRv3 {
  return {
    version: "financial_query_ir.v3",
    intent: "analyze",
    dialogue: { acts: ["new_query"], topic_id: null, inherits_from_topic_id: null },
    needs_clarification: [],
    assumptions: [],
    queries,
    completeness_targets: [{ id: "t1", query_id: queries[0].id, claim: "money", required: true }],
    period: { from: queries[0].time.from!, to: queries[0].time.to!, label: "janela" },
    comparison_period: null,
    source: "semantic_compiler",
    unsupported_reason: null,
  };
}

describe("resolveTimeAspectPt — hábito vs recorte pontual", () => {
  it("'por mês' vira hábito sobre meses completos, nunca o parcial do mês", () => {
    const r = resolveTimeAspectPt("quanto eu gasto com alimentação por mês?", NOW);
    expect(r.aspect).toBe("habitual");
    expect(r.grain).toBe("month");
    expect(r.reduce).toBe("typical");
    expect(r.exclude_partial).toBe(true);
    expect(r.n).toBe(HABITUAL_WINDOW_MONTHS);
    expect(r.to).toBe("2026-08-31");
    expect(r.from).toBe("2026-03-01");
    expect(r.assumption).toContain("6 meses completos");
    expect(r.ambiguous).toBe(false);
  });

  it("'quanto gastei' sem período é MTD e AMBÍGUO (default declarado, não fato)", () => {
    const r = resolveTimeAspectPt("quanto gastei com alimentação?", NOW);
    expect(r.aspect).toBe("mtd");
    expect(r.exclude_partial).toBe(false);
    expect(r.ambiguous).toBe(true);
    expect(r.from).toBe("2026-09-01");
  });

  it("'média mensal' usa mean explícita sobre meses fechados", () => {
    const r = resolveTimeAspectPt("qual minha média mensal de gastos nos últimos 4 meses?", NOW);
    expect(r.reduce).toBe("mean");
    expect(r.exclude_partial).toBe(true);
    expect(r.n).toBe(4);
    expect(r.to).toBe("2026-08-31");
  });

  it("mês nomeado explícito é calendar fechado, com soma", () => {
    const r = resolveTimeAspectPt("quanto gastei em julho?", NOW);
    expect(r.aspect).toBe("calendar");
    expect(r.reduce).toBe("sum");
    expect(r.from).toBe("2026-07-01");
    expect(r.to).toBe("2026-07-31");
  });

  it("janela móvel de dias preserva o aspecto rolling", () => {
    const r = resolveTimeAspectPt("quanto gastei nos últimos 90 dias?", NOW);
    expect(r.aspect).toBe("rolling");
    expect(r.n).toBe(90);
  });

  it("evolução e projeção têm aspectos próprios", () => {
    expect(resolveTimeAspectPt("como está minha evolução financeira?", NOW).aspect).toBe("trend");
    expect(resolveTimeAspectPt("quanto eu devo fechar esse mês?", NOW).aspect).toBe("projection");
  });

  it("lastCompleteMonths nunca inclui o mês corrente", () => {
    const w = lastCompleteMonths(3, NOW);
    expect(w.from).toBe("2026-06-01");
    expect(w.to).toBe("2026-08-31");
  });
});

describe("financial_query_ir.v3 — validação estrutural", () => {
  it("aceita o shape habitual completo", () => {
    expect(validateFinancialIRv3(ir([habitualQuery()]))).toEqual([]);
  });

  it("rejeita habitual sem grain mensal", () => {
    const errors = validateFinancialIRv3(ir([habitualQuery({ grain: "none" })]));
    expect(errors).toContain("q1_habitual_requires_month_grain");
  });

  it("rejeita habitual que inclui o mês parcial", () => {
    const q = habitualQuery();
    q.time = { ...q.time, exclude_partial: false };
    expect(validateFinancialIRv3(ir([q]))).toContain("q1_habitual_requires_exclude_partial");
  });

  it("rejeita estatística típica sobre janela parcial", () => {
    const q = habitualQuery({ reduce: "typical" });
    q.time = { ...q.time, aspect: "mtd", exclude_partial: false };
    const errors = validateFinancialIRv3(ir([q]));
    expect(errors).toContain("q1_typical_requires_complete_window");
  });

  it("rejeita saldo com série temporal", () => {
    const q = habitualQuery({ metric: "balance", reduce: "none", grain: "month", filters: [] });
    expect(validateFinancialIRv3(ir([q])).some((e) => e.includes("state_metric_with_series"))).toBe(true);
  });

  it("canonicaliza v1 preservando filtros e período por query", () => {
    const v1 = {
      version: "financial_query_ir.v1",
      intent: "analyze",
      needs_clarification: [],
      assumptions: [],
      queries: [{
        id: "q1", metric: "expense_amount", operation: "sum",
        group_by: [], filters: [{ field: "category", op: "eq", value: "Transporte" }], limit: null,
      }],
      completeness_targets: ["q1.result"],
      period: { from: "2026-07-01", to: "2026-07-31", label: "julho" },
      comparison_period: null,
      source: "semantic_compiler",
      unsupported_reason: null,
    };
    const v3 = normalizeToV3(v1 as never, { today: "2026-09-11" });
    expect(v3.version).toBe("financial_query_ir.v3");
    expect(v3.queries[0].filters).toEqual([{ field: "category", op: "eq", value: "Transporte" }]);
    expect(v3.queries[0].time.from).toBe("2026-07-01");
    expect(v3.queries[0].time.aspect).toBe("calendar");
    expect(validateFinancialIRv3(v3)).toEqual([]);
  });

  it("shape típico mensal é reconhecido só pelo IR", () => {
    expect(isTypicalMonthlyShape(habitualQuery())).toBe(true);
    expect(isTypicalMonthlyShape(habitualQuery({ grain: "none", reduce: "sum" }))).toBe(false);
  });
});

describe("preservação requested-vs-executed", () => {
  const requested = habitualQuery();
  const executed: ExecutedIR = {
    metric: "expense_amount",
    filters: [{ field: "category", op: "eq", value: "alimentação" }],
    time: { aspect: "habitual", from: requested.time.from, to: requested.time.to, n: 6, exclude_partial: true },
    grain: "month",
    reduce: "typical",
    group_by: [],
    partial: false,
  };

  it("compatível quando a engine roda exatamente o pedido", () => {
    expect(requestedSubsumesExecuted(requested, executed).compatible).toBe(true);
  });

  it("filtro perdido é incompatível (agregado global nunca responde escopo)", () => {
    const r = requestedSubsumesExecuted(requested, { ...executed, filters: [] });
    expect(r.compatible).toBe(false);
    expect(r.mismatches.some((m) => m.reason === "filter_lost")).toBe(true);
  });

  it("filtro extra também é incompatível", () => {
    const r = requestedSubsumesExecuted(requested, {
      ...executed,
      filters: [...executed.filters, { field: "card", op: "eq", value: "Nubank" }],
    });
    expect(r.mismatches.some((m) => m.reason === "filter_added")).toBe(true);
  });

  it("mês parcial incluído numa pergunta de hábito é incompatível", () => {
    const r = requestedSubsumesExecuted(requested, {
      ...executed,
      time: { ...executed.time, to: "2026-09-11", exclude_partial: false },
    });
    expect(r.compatible).toBe(false);
    expect(r.mismatches.map((m) => m.reason)).toContain("partial_month_included");
  });

  it("soma respondendo pergunta de típico é incompatível", () => {
    expect(requestedSubsumesExecuted(requested, { ...executed, reduce: "sum" }).compatible).toBe(false);
  });

  it("mediana atende pedido de típico", () => {
    expect(requestedSubsumesExecuted(requested, { ...executed, reduce: "median" }).compatible).toBe(true);
  });

  it("executed_ir ausente nunca passa", () => {
    expect(requestedSubsumesExecuted(requested, null).compatible).toBe(false);
  });

  it("plano com uma query incompatível reprova inteiro", () => {
    const r = planPreservation([
      { requested, executed },
      { requested: habitualQuery({ id: "q2" }), executed: { ...executed, metric: "balance" } },
    ]);
    expect(r.compatible).toBe(false);
    expect(r.mismatches[0].reason.startsWith("q2:")).toBe(true);
  });

  it("claims permitidos vêm só das métricas pedidas", () => {
    expect(allowedClaimDomains([requested])).toEqual(["expense_amount"]);
  });
});

describe("política do gasto típico mensal", () => {
  const window = { from: "2026-03-01", to: "2026-08-31", n: 6 };

  it("mediana é o número principal e a média é auxiliar", () => {
    const buckets = monthsInWindow(window.from, window.to).map((month, i) => ({
      month, total: [800, 820, 810, 830, 805, 815][i], has_data: true,
    }));
    const r = typicalMonthlyPolicy({ buckets, window, preferred: "typical" });
    expect(r.statistic).toBe("median");
    expect(r.headline).toBe(median([800, 820, 810, 830, 805, 815]));
    expect(r.mean).toBe(mean([800, 820, 810, 830, 805, 815]));
    expect(r.low_confidence).toBe(false);
    expect(r.divergent).toBe(false);
  });

  it("mês sem dados não conta como gasto zero", () => {
    const buckets = monthsInWindow(window.from, window.to).map((month, i) => ({
      month, total: i < 4 ? 1000 : 0, has_data: i < 4,
    }));
    const r = typicalMonthlyPolicy({ buckets, window, preferred: "typical" });
    expect(r.months_with_data).toBe(4);
    expect(r.median).toBe(1000);
    expect(r.caveats.join(" ")).toContain("não contei como mês de gasto zero");
  });

  it("menos de 3 meses vira leitura pouco firme", () => {
    const buckets = monthsInWindow(window.from, window.to).map((month, i) => ({
      month, total: i < 2 ? 500 : 0, has_data: i < 2,
    }));
    expect(typicalMonthlyPolicy({ buckets, window, preferred: "typical" }).low_confidence).toBe(true);
  });

  it("divergência de 20% entre mediana e média é dita com os dois números", () => {
    const buckets = monthsInWindow(window.from, window.to).map((month, i) => ({
      month, total: [500, 510, 505, 520, 515, 4000][i], has_data: true,
    }));
    const r = typicalMonthlyPolicy({ buckets, window, preferred: "typical" });
    expect(r.divergent).toBe(true);
    expect(r.caveats.join(" ")).toContain(String(r.median));
    expect(r.caveats.join(" ")).toContain(String(r.mean));
  });

  it("executed_ir do handler declara janela fechada e estatística real", () => {
    const buckets = monthsInWindow(window.from, window.to).map((month) => ({ month, total: 900, has_data: true }));
    const result = typicalMonthlyPolicy({ buckets, window, preferred: "typical" });
    const executed = typicalMonthlyExecutedIR(habitualQuery(), result);
    expect(executed.time.exclude_partial).toBe(true);
    expect(executed.reduce).toBe("typical");
    expect(requestedSubsumesExecuted(habitualQuery(), executed).compatible).toBe(true);
  });

  it("sem nenhum mês com dado a resposta é honesta, não um zero", () => {
    const buckets = monthsInWindow(window.from, window.to).map((month) => ({ month, total: 0, has_data: false }));
    const r = typicalMonthlyPolicy({ buckets, window, preferred: "typical" });
    expect(r.headline).toBeNull();
    expect(r.caveats[0]).toContain("não tenho um padrão");
  });
});
