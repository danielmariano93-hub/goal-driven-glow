/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures de IR parciais */
// Conjunto dourado de COBERTURA (`nino_coverage_golden.v1`), camada offline.
//
// Cada caso é uma pergunta real (ou fiel às reais) já no formato de IR que o
// compilador emite. O teste mede se `mappingForQuery` tem motor para ela e
// TRAVA o resultado: a linha de base fica registrada e qualquer mudança de
// cobertura (para mais ou para menos) precisa ser declarada aqui. Lacuna que
// passa a ser executável vira `mapped` neste arquivo, de propósito.
//
// Não mede acerto numérico (isso é a camada fim a fim contra o banco); mede o
// buraco estrutural: "existe caminho executável para esta combinação?".
import { describe, expect, it } from "vitest";
import { mappingForQuery } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter.ts";
import { genericAggregateMapping } from "../../supabase/functions/_shared/agent/core/GenericAggregateEligibility.ts";
import { executionPlanTelemetry } from "../../supabase/functions/_shared/agent/core/ExecutionPlanTelemetry.ts";

const period = { from: "2026-09-01", to: "2026-09-30", label: "setembro" };
const comparison = { from: "2026-08-01", to: "2026-08-31" };
const ir = { period, comparison_period: comparison } as any;
const irGeneric = { ...ir, execution_options: { generic_aggregate: true } } as any;
const f = (field: string, value: string) => ({ field, op: "eq", value });
const q = (over: Record<string, unknown>) => ({
  id: "q1", metric: "expense_amount", operation: "sum", group_by: [], filters: [],
  limit: null, depends_on: [], ...over,
} as any);

type Case = {
  ask: string; query: any; family: string; status: "mapped" | "gap";
  /** Status com `generic_aggregate_v1` ligada; omitido = igual ao padrão. */
  withGeneric?: "mapped" | "gap";
};

export const GOLDEN: Case[] = [
  { ask: "quanto gastei em lazer em setembro?", family: "total_categoria", status: "mapped",
    query: q({ filters: [f("category", "Lazer")] }) },
  { ask: "quanto gastei por categoria?", family: "breakdown_categoria", status: "mapped",
    query: q({ operation: "breakdown", group_by: ["category"] }) },
  { ask: "top 5 categorias que mais gastei", family: "rank_categoria", status: "mapped",
    query: q({ operation: "rank", group_by: ["category"], limit: 5 }) },
  { ask: "quanto gastei no cartão Nubank?", family: "total_cartao", status: "mapped",
    query: q({ filters: [f("card", "Nubank")] }) },
  { ask: "quanto gastei no Thales?", family: "total_estabelecimento", status: "mapped",
    query: q({ filters: [f("merchant", "Thales")] }) },
  { ask: "quanto gastei com lazer no Thales?", family: "estab_x_categoria", status: "mapped",
    query: q({ filters: [f("merchant", "Thales"), f("category", "Lazer")] }) },
  { ask: "quais os estabelecimentos de lazer?", family: "rank_estabelecimento", status: "mapped",
    query: q({ operation: "rank", group_by: ["merchant"], filters: [f("category", "Lazer")] }) },
  { ask: "lazer no Thales mês a mês", family: "serie_mensal_filtrada", status: "mapped",
    query: q({ operation: "trend", group_by: ["month"], filters: [f("merchant", "Thales"), f("category", "Lazer")] }) },
  { ask: "gráfico diário de setembro com transporte no Uber", family: "serie_diaria_filtrada", status: "mapped",
    query: q({ operation: "trend", group_by: ["day"], filters: [f("merchant", "Uber"), f("category", "Transporte")] }) },
  { ask: "lazer neste mês comparado com o mês anterior", family: "comparar_categoria", status: "mapped",
    query: q({ operation: "compare", filters: [f("category", "Lazer")] }) },
  // --- lacunas conhecidas (linha de base) ---
  { ask: "quanto gasto por mês com assinaturas?", family: "soma_mensal_sem_filtro_estab", status: "gap", withGeneric: "mapped",
    query: q({ operation: "breakdown", group_by: ["month"], filters: [f("category", "Assinaturas")] }) },
  { ask: "em que dia da semana gasto mais?", family: "dia_da_semana", status: "gap", withGeneric: "mapped",
    query: q({ operation: "breakdown", group_by: ["weekday"] }) },
  { ask: "meus gastos no Thales por categoria", family: "estab_agrupado_categoria", status: "gap", withGeneric: "mapped",
    query: q({ operation: "breakdown", group_by: ["category"], filters: [f("merchant", "Thales")] }) },
  { ask: "gastos no Uber por cartão", family: "estab_agrupado_cartao", status: "gap", withGeneric: "mapped",
    query: q({ operation: "breakdown", group_by: ["card"], filters: [f("merchant", "Uber")] }) },
  { ask: "quanto gastei no Thales no cartão Nubank?", family: "estab_x_cartao", status: "gap", withGeneric: "mapped",
    query: q({ filters: [f("merchant", "Thales"), f("card", "Nubank")] }) },
  { ask: "gastos por estabelecimento no cartão Nubank", family: "estab_agrupado_filtro_cartao", status: "gap", withGeneric: "mapped",
    query: q({ operation: "breakdown", group_by: ["merchant"], filters: [f("card", "Nubank")] }) },
  { ask: "gasto mensal por categoria", family: "dois_agrupamentos", status: "gap",
    query: q({ operation: "breakdown", group_by: ["month", "category"] }) },
  { ask: "total de lazer por semana no cartão Nubank", family: "serie_semanal_cartao", status: "gap", withGeneric: "mapped",
    query: q({ operation: "trend", group_by: ["week"], filters: [f("category", "Lazer"), f("card", "Nubank")] }) },
];

const statusOf = (c: Case) => (mappingForQuery(c.query, ir) ? "mapped" : "gap");
const statusWithGeneric = (c: Case) => (mappingForQuery(c.query, irGeneric) ? "mapped" : "gap");

describe("conjunto dourado de cobertura (offline)", () => {
  for (const c of GOLDEN) {
    it(`${c.family}: "${c.ask}" → ${c.status}`, () => {
      expect(statusOf(c)).toBe(c.status);
    });
  }

  for (const c of GOLDEN) {
    it(`com executor genérico: ${c.family} → ${c.withGeneric ?? c.status}`, () => {
      expect(statusWithGeneric(c)).toBe(c.withGeneric ?? c.status);
    });
  }

  it("relatório da linha de base", () => {
    const mapped = GOLDEN.filter((c) => statusOf(c) === "mapped").length;
    const withGeneric = GOLDEN.filter((c) => statusWithGeneric(c) === "mapped").length;
    console.log(`[cobertura dourada] ${mapped}/${GOLDEN.length} com motor dedicado; ${withGeneric}/${GOLDEN.length} com executor genérico`);
    expect(GOLDEN.length).toBeGreaterThanOrEqual(18);
  });
});

describe("telemetria do plano (`nino_coverage_telemetry.v1`)", () => {
  it("grava assinatura e contagem de filtros, nunca o valor do filtro", () => {
    const plan = executionPlanTelemetry({
      intent: "analyze", needs_clarification: [], comparison_period: null,
      queries: [q({ filters: [f("merchant", "Thales Secreto"), f("category", "Lazer")], group_by: ["month"], operation: "trend" })],
    } as any);
    expect(plan?.queries[0].signature).toBe("expense_amount/trend/group:month/filters:category+merchant");
    expect(plan?.queries[0].filter_count).toBe(2);
    expect(JSON.stringify(plan)).not.toContain("Thales");
    expect(JSON.stringify(plan)).not.toContain("Lazer");
  });

  it("sem IR devolve null", () => {
    expect(executionPlanTelemetry(null)).toBeNull();
  });
});

describe("elegibilidade do executor genérico (limites que preservam a verdade)", () => {
  const generic = (query: any) => genericAggregateMapping(query, ir)?.tool;
  const dedicatedOnly = (query: any) => mappingForQuery(query, ir)?.tool;

  it("com a flag desligada nunca usa o executor genérico", () => {
    expect(dedicatedOnly(q({ operation: "breakdown", group_by: ["weekday"] }))).toBeUndefined();
  });

  it("motor dedicado tem prioridade sobre o genérico", () => {
    expect(mappingForQuery(q({ filters: [f("category", "Lazer")] }), irGeneric)?.tool).not.toBe("spending_aggregate");
  });

  it("tendência sem dimensão de tempo é recusada (seria um total)", () => {
    expect(generic(q({ operation: "trend", filters: [f("merchant", "Thales"), f("card", "Nubank")] }))).toBeUndefined();
  });

  it("'por dia da semana' emitido como tendência executa como detalhamento semanal", () => {
    expect(generic(q({ operation: "trend", group_by: ["weekday"], filters: [f("merchant", "Uber")] }))).toBe("spending_aggregate");
  });

  it("forma de pagamento é normalizada; valor fora do catálogo é recusado (nunca vira R$ 0)", () => {
    const base = { operation: "sum", group_by: ["week"] };
    const args = (v: string) => genericAggregateMapping(q({ ...base, filters: [f("payment_method", v)] }), ir)?.args as any;
    expect(args("cartão").payment_method).toBe("credit_card");
    expect(args("Cartão de Crédito").payment_method).toBe("credit_card");
    expect(args("conta").payment_method).toBe("account");
    expect(args("dinheiro vivo")).toBeUndefined();
  });

  it("ranking e detalhamento sem dimensão são recusados", () => {
    expect(generic(q({ operation: "rank", filters: [f("merchant", "Thales"), f("card", "Nubank")] }))).toBeUndefined();
  });

  it("filtro repetido, operador diferente de eq e dimensão já fixada por filtro são recusados", () => {
    expect(generic(q({ filters: [f("merchant", "A"), f("merchant", "B")] }))).toBeUndefined();
    expect(generic(q({ filters: [{ field: "merchant", op: "neq", value: "A" }, f("card", "Nubank")] }))).toBeUndefined();
    expect(generic(q({ operation: "breakdown", group_by: ["card"], filters: [f("card", "Nubank"), f("merchant", "Uber")] }))).toBeUndefined();
  });

  it("receita por categoria é recusada (categoria é só de despesa)", () => {
    expect(generic(q({ metric: "income_amount", operation: "breakdown", group_by: ["category"], filters: [f("merchant", "Empresa")] }))).toBeUndefined();
  });

  it("série diária em janela longa demais é recusada", () => {
    const longIr = { ...irGeneric, period: { from: "2026-01-01", to: "2026-09-30", label: "ano" } };
    expect(mappingForQuery(q({ operation: "sum", group_by: ["day"], filters: [f("card", "Nubank")] }), longIr)).toBeNull();
  });
});
