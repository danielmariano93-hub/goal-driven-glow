/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures de IR parciais */
// Gráficos de série = template por grão + dados executados + período/recorte.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requestedSeriesGrain } from "../../supabase/functions/_shared/agent/core/SeriesGrain";
import { inferChartRequest } from "../../supabase/functions/_shared/intelligence/chartIntent";
import {
  buildScopedSeries,
  capSeriesWindow,
  scopedSeriesText,
  seriesBuckets,
} from "../../supabase/functions/_shared/agent/core/handlers/ScopedSeriesHandler";
import {
  mergeExecutedSeriesEvidence,
  SERIES_CHART_TEMPLATES,
  seriesChartFromEvidence,
} from "../../supabase/functions/_shared/intelligence/chartTemplates";
import { isMonthlySeriesShape, isScopedSeriesShape, type FinancialQueryV3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import { coherentOperation } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { repairSeriesGrain } from "../../supabase/functions/_shared/agent/core/SeriesGrainRepair";
import { buildNarrativeEvidencePack } from "../../supabase/functions/_shared/agent/narrative/NarrativeEvidencePack";
import { guardNarrative } from "../../supabase/functions/_shared/agent/narrative/NarrativeGuard";
import { toneRulesFor } from "../../supabase/functions/_shared/agent/narrative/TonePolicy";
import { chartDayLabel } from "../../supabase/functions/_shared/artifacts/png";

const UBER_SEPTEMBER = [
  { date: "2026-09-02", amount: 23.9 },
  { date: "2026-09-02", amount: 18.1 },
  { date: "2026-09-10", amount: 55 },
  { date: "2026-09-21", amount: 31.45 },
  { date: "2026-08-31", amount: 999 }, // fora da janela
];
const scope = { category_label: "Transporte", merchant: "Uber" };

describe("grão pedido: uma única fonte", () => {
  it.each([
    ["Nino me traga um gráfico diário do mês de setembro dos gastos que tive com transporte no estabelecimento Uber", "day"],
    ["Quero um gráfico dia a dia nessa categoria e nesse estabelecimento", "day"],
    ["Me traga isso em gráfico diário agora", "day"],
    ["faz o gráfico por dia do Uber", "day"],
    ["gráfico semanal do iFood nos últimos 3 meses", "week"],
    ["quero ver semana a semana meus gastos com mercado", "week"],
    ["gráfico trimestral de Lazer em 2026", "quarter"],
    ["gráfico de Alimentação mês a mês", "month"],
  ])("\"%s\" → %s", (text, grain) => {
    expect(requestedSeriesGrain(text)).toBe(grain);
  });

  it.each([
    "qual minha média diária com Uber?",
    "quanto gastei por dia com Uber?",
    "quanto eu gasto por mês com transporte?",
    "quanto gastei com Uber em setembro?",
    "qual meu ritmo semanal de gastos?",
  ])("\"%s\" não é pedido de série", (text) => {
    expect(requestedSeriesGrain(text)).toBeNull();
  });

  it("o pedido de gráfico usa o mesmo grão (e vence 'categoria' no texto)", () => {
    expect(inferChartRequest("gráfico dia a dia nessa categoria e nesse estabelecimento")).toEqual({ mode: "series", grain: "day" });
    expect(inferChartRequest("gráfico semanal do iFood")).toEqual({ mode: "series", grain: "week" });
    expect(inferChartRequest("gráfico trimestral de Lazer")).toEqual({ mode: "series", grain: "quarter" });
    expect(inferChartRequest("gráfico de Transporte mês a mês")).toEqual({ mode: "monthly_series" });
    expect(inferChartRequest("gráfico da média diária")?.mode).not.toBe("series");
  });
});

describe("motor de série com recorte (dia, semana, trimestre)", () => {
  it("dia: um ponto por dia, janela respeitada, pico e média", () => {
    const r = buildScopedSeries(UBER_SEPTEMBER, { grain: "day", from: "2026-09-01", to: "2026-09-30", ...scope });
    expect(r.points).toHaveLength(30);
    expect(r.total).toBe(128.45);
    expect(r.transaction_count).toBe(4);
    expect(r.active_points).toBe(3);
    expect(r.points[1]).toMatchObject({ key: "2026-09-02", label: "02/09", total: 42, transaction_count: 2 });
    expect(r.peak).toMatchObject({ key: "2026-09-10", total: 55 });
  });

  it("semana: segunda a domingo, bordas recortadas à janela", () => {
    const buckets = seriesBuckets("week", "2026-09-01", "2026-09-30");
    expect(buckets[0]).toMatchObject({ key: "2026-08-31", from: "2026-09-01", to: "2026-09-06" });
    expect(buckets.at(-1)).toMatchObject({ from: "2026-09-28", to: "2026-09-30" });
    expect(buckets).toHaveLength(5);
    const r = buildScopedSeries(UBER_SEPTEMBER, { grain: "week", from: "2026-09-01", to: "2026-09-30", ...scope });
    expect(r.points.map((p) => p.total)).toEqual([42, 55, 0, 31.45, 0]);
  });

  it("trimestre: T1..T4 com rótulo curto", () => {
    const buckets = seriesBuckets("quarter", "2026-01-01", "2026-12-31");
    expect(buckets.map((b) => b.label)).toEqual(["T1/26", "T2/26", "T3/26", "T4/26"]);
    expect(buckets[2]).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("janela legível por grão (dia: até 93 pontos)", () => {
    expect(capSeriesWindow("day", "2026-01-01", "2026-12-31")).toEqual({ from: "2026-01-01", to: "2026-04-03" });
    expect(capSeriesWindow("week", "2026-09-01", "2026-09-30")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("texto diagramado com o vocabulário do grão", () => {
    const day = scopedSeriesText(buildScopedSeries(UBER_SEPTEMBER, { grain: "day", from: "2026-09-01", to: "2026-09-30", ...scope })).replace(/\u00a0/g, " ");
    expect(day.startsWith("📊 *Transporte no Uber, dia a dia* (01/09 a 30/09)")).toBe(true);
    expect(day).toContain("*Total:* R$ 128,45 em 4 lançamentos");
    expect(day).toContain("*Dias com gasto:* 3 de 30");
    expect(day).toContain("• 02/09: R$ 42,00 (2 lançamentos)");
    const week = scopedSeriesText(buildScopedSeries(UBER_SEPTEMBER, { grain: "week", from: "2026-09-01", to: "2026-09-30", ...scope })).replace(/\u00a0/g, " ");
    expect(week).toContain("semana a semana");
    expect(week).toContain("• 01/09 a 06/09: R$ 42,00 (2 lançamentos)");
    expect(week).toContain("• 14/09 a 20/09: sem lançamentos");
  });
});

describe("templates de gráfico", () => {
  it.each(["day", "week", "quarter"] as const)("grão %s: título, eixo e barras vêm do template + evidência", (grain) => {
    const from = grain === "quarter" ? "2026-01-01" : "2026-09-01";
    const result = buildScopedSeries(UBER_SEPTEMBER, { grain, from, to: "2026-09-30", ...scope });
    const chart = seriesChartFromEvidence(result, grain)!;
    expect(chart.grain).toBe(grain);
    expect(chart.template).toBe(SERIES_CHART_TEMPLATES[grain]);
    expect(chart.payload.title).toBe(`${SERIES_CHART_TEMPLATES[grain].title} · Transporte no Uber`);
    expect(chart.payload.chart.x_labels).toEqual(result.points.map((p) => p.label));
    const sum = (chart.payload.chart.series[0].data as number[]).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(result.total, 2);
    expect(chart.payload.provenance.period).toMatchObject({ from, to: "2026-09-30" });
  });

  it("eixo do PNG do WhatsApp: dia, mês e trimestre legíveis", () => {
    expect(chartDayLabel("05/09")).toBe("05");
    expect(chartDayLabel("set/26")).toBe("09/26");
    expect(chartDayLabel("T3/26")).toBe("t3/26");
  });

  it("grão pedido diferente do executado não vira outro gráfico", () => {
    const daily = buildScopedSeries(UBER_SEPTEMBER, { grain: "day", from: "2026-09-01", to: "2026-09-30", ...scope });
    expect(seriesChartFromEvidence(daily, "month")).toBeNull();
    expect(seriesChartFromEvidence(daily, "week")).toBeNull();
    expect(seriesChartFromEvidence(buildScopedSeries([], { grain: "day", from: "2026-09-01", to: "2026-09-30" }), "day")).toBeNull();
  });

  it("evidência gravada sem resultado é completada pelo resultado executado (defeito de produção)", () => {
    const daily = buildScopedSeries(UBER_SEPTEMBER, { grain: "day", from: "2026-09-01", to: "2026-09-30", ...scope });
    const stored = [{ step_index: 0, tool_name: "spending_timeseries_scoped", args: {}, result: null, ok: true, duration_ms: 0, error: null }];
    const merged = mergeExecutedSeriesEvidence(stored, [{ tool_name: "spending_timeseries_scoped", args: {}, result: daily, ok: true }]);
    expect(merged[0].result).toBe(daily);
    expect(mergeExecutedSeriesEvidence([], [{ tool_name: "spending_timeseries_scoped", result: daily, ok: true }])).toHaveLength(1);
    // Resultado que não é série não entra.
    expect(mergeExecutedSeriesEvidence([], [{ tool_name: "merchant_profile", result: { total: 1 }, ok: true }])).toHaveLength(0);
  });
});

describe("IR: grão ponta a ponta", () => {
  it("group_by temporal sempre vira tendência", () => {
    for (const grain of ["day", "week", "month", "quarter"]) {
      expect(coherentOperation("sum", [grain])).toBe("trend");
    }
    expect(coherentOperation("sum", ["category"])).toBe("breakdown");
  });

  it("shape de série com recorte reconhece dia/semana/trimestre e não confunde com o mês", () => {
    const base = {
      metric: "expense_amount", reduce: "none",
      filters: [{ field: "category", op: "eq", value: "Transporte" }, { field: "merchant", op: "eq", value: "Uber" }],
      time: { aspect: "trend", from: "2026-09-01", to: "2026-09-30" },
    };
    for (const grain of ["day", "week", "quarter"]) {
      const q = { ...base, grain, group_by: [grain] } as unknown as FinancialQueryV3;
      expect(isScopedSeriesShape(q)).toBe(true);
      expect(isMonthlySeriesShape(q)).toBe(false);
    }
    expect(isScopedSeriesShape({ ...base, grain: "month", group_by: ["month"] } as unknown as FinancialQueryV3)).toBe(false);
    expect(isScopedSeriesShape({ ...base, grain: "day", group_by: ["day"], filters: [{ field: "account", op: "eq", value: "x" }] } as unknown as FinancialQueryV3)).toBe(false);
  });

  it("reparo do grão: só com pedido explícito, só para recorte categoria/estabelecimento", () => {
    const ir = (over: Record<string, unknown>) => ({
      version: "financial_query_ir.v2", intent: "lookup", period: { from: "2026-09-01", to: "2026-09-30", label: "setembro" },
      comparison_period: null, assumptions: [], needs_clarification: [], completeness_targets: [], source: "compiler", unsupported_reason: null,
      queries: [{ id: "q1", metric: "expense_amount", operation: "sum", group_by: [], filters: [{ field: "merchant", op: "eq", value: "Uber" }], limit: null, depends_on: [], ...over }],
    }) as any;
    expect(repairSeriesGrain(ir({}), "gráfico semanal do Uber").ir.queries[0]).toMatchObject({ operation: "trend", group_by: ["week"] });
    expect(repairSeriesGrain(ir({ group_by: ["month"], operation: "trend" }), "me traga isso em gráfico diário").ir.queries[0]).toMatchObject({ group_by: ["day"] });
    expect(repairSeriesGrain(ir({}), "quanto gastei com Uber?").repaired).toBe(false);
    expect(repairSeriesGrain(ir({ operation: "rank", group_by: ["merchant"] }), "gráfico diário").repaired).toBe(false);
    expect(repairSeriesGrain(ir({ filters: [{ field: "account", op: "eq", value: "Nubank" }] }), "gráfico diário").repaired).toBe(false);
  });

  it("interpretador conhece todos os grãos", () => {
    const prompt = readFileSync("supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts", "utf8");
    expect(prompt).toContain('"day", "week", "quarter"]');
    expect(prompt).toContain("group_by=[week]");
    expect(prompt).toContain("group_by=[quarter]");
    expect(prompt).toContain("Nunca troque o grão pedido");
    expect(prompt).toContain("merchant=Thales SÓ (sem category=Lazer)");
    expect(prompt).toContain("NÃO peça esclarecimento de categoria/estabelecimento");
  });

  it("app nunca troca o gráfico da evidência por um genérico sem filtro", () => {
    const app = readFileSync("supabase/functions/_shared/agent/core/adapters/AppAdapter.ts", "utf8");
    expect(app).toContain("!executedFinancialRead && wantsChart(args.text)");
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(core).toContain("executed_calls:");
    expect(core).toMatch(/compose_kind: laidOut\s*\?\s*"layout"/);
  });
});

describe("alerta proativo não vaza métrica interna nem número cru", () => {
  const candidate = {
    kind: "spending_pace_change",
    severity: "attention" as const,
    title: "Gasto acima do normal",
    body: "Seus gastos em Alimentação somam R$ 190,09 acima do ritmo típico.",
    evidence: {
      deterministic_body: "Seus gastos em Alimentação somam R$ 190,09 acima do ritmo típico.",
      impact_amount: 190.09,
      value_score: 116.12,
      confidence: 0.63,
      priority_score: 88,
      sample_size: 17,
    },
  };

  it("score, confiança e amostras não entram como fato narrável", () => {
    const pack = buildNarrativeEvidencePack(candidate);
    const keys = [pack.primary_fact, ...pack.supporting_facts].filter(Boolean).map((f) => f!.key);
    expect(keys).toContain("impact_amount");
    for (const internal of ["value_score", "confidence", "priority_score", "sample_size"]) {
      expect(keys).not.toContain(internal);
    }
    expect(pack.allowed_numbers).not.toContain(116.12);
  });

  it("a guarda barra jargão interno e valor sem formato brasileiro", () => {
    const pack = buildNarrativeEvidencePack(candidate);
    const rules = toneRulesFor("attention");
    expect(guardNarrative({ text: "O score de valor atual é alto em Alimentação.", pack, rules }).violations).toContain("internal_jargon");
    expect(guardNarrative({ text: "Apareceu com confiança de 63% em Alimentação.", pack, rules }).violations).toContain("internal_jargon");
    expect(guardNarrative({ text: "Você gastou 190.09 a mais em Alimentação.", pack, rules }).violations).toContain("unformatted_number");
    const ok = guardNarrative({ text: "Alimentação passou do seu ritmo: R$ 190,09 acima do típico.", pack, rules });
    expect(ok.violations).not.toContain("unformatted_number");
    expect(ok.violations).not.toContain("internal_jargon");
  });
});
