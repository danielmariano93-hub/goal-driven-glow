// nino_daily_series.v1 — pedidos reais que o Nino respondia com o gráfico
// mensal ("gráfico diário de setembro de Transporte no Uber").
import { describe, expect, it } from "vitest";
import { inferChartRequest } from "../../supabase/functions/_shared/intelligence/chartIntent";
import {
  buildDailySeries,
  dailySpendingSeriesText,
} from "../../supabase/functions/_shared/agent/core/handlers/DailySeriesHandler";
import {
  buildDailySeriesChartArtifact,
  dailySeriesChartCaption,
} from "../../supabase/functions/_shared/intelligence/monthlySeriesChart";
import { isDailySeriesShape, isMonthlySeriesShape, type FinancialQueryV3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import { bridgeTurnSpecV3ToRuntime, coherentOperation } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { verifySemanticInvariantsV3 } from "../../supabase/functions/_shared/agent/v3/SemanticInvariantsV3";
import type { TaskTurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";
import { buildNarrativeEvidencePack } from "../../supabase/functions/_shared/agent/narrative/NarrativeEvidencePack";
import { guardNarrative } from "../../supabase/functions/_shared/agent/narrative/NarrativeGuard";
import { toneRulesFor } from "../../supabase/functions/_shared/agent/narrative/TonePolicy";

const NOW = new Date("2026-09-30T15:00:00-03:00");
const sourced = (value: string) => ({ value, source: "current_turn" as const, source_span: value });

const uber = () => buildDailySeries([
  { date: "2026-09-02", amount: 23.9 },
  { date: "2026-09-02", amount: 18.1 },
  { date: "2026-09-10", amount: 55 },
  { date: "2026-09-21", amount: 31.45 },
  { date: "2026-08-31", amount: 999 }, // fora da janela
], { from: "2026-09-01", to: "2026-09-30", category_label: "Transporte", merchant: "Uber" });

describe("pedidos reais de gráfico diário", () => {
  it.each([
    "Me gere um gráfico diário do mês de setembro dos gastos que tive em transporte no estabelecimento Uber",
    "Quero um gráfico dia a dia nessa categoria e nesse estabelecimento",
    "faz o gráfico por dia do Uber",
  ])("\"%s\" vira série diária, não mensal nem ranking de categorias", (text) => {
    expect(inferChartRequest(text)).toEqual({ mode: "daily_series" });
  });

  it("média diária e mês a mês continuam com o próprio modo", () => {
    expect(inferChartRequest("gráfico de Transporte mês a mês")).toEqual({ mode: "monthly_series" });
    expect(inferChartRequest("gráfico da média diária por categoria")?.mode).not.toBe("daily_series");
  });
});

describe("série diária determinística", () => {
  it("soma por dia, respeita a janela e calcula pico e média nos dias com gasto", () => {
    const result = uber();
    expect(result.days).toHaveLength(30);
    expect(result.total).toBe(128.45);
    expect(result.transaction_count).toBe(4);
    expect(result.active_days).toBe(3);
    expect(result.peak).toEqual({ date: "2026-09-10", total: 55, transaction_count: 1 });
    expect(result.days[1]).toEqual({ date: "2026-09-02", total: 42, transaction_count: 2 });
    expect(result.average_per_active_day).toBe(42.82);
  });

  it("texto diagramado com escopo, totais e os dias que mais pesaram", () => {
    const text = dailySpendingSeriesText(uber()).replace(/\u00a0/g, " ");
    expect(text.startsWith("📊 *Transporte no Uber, dia a dia* (01/09 a 30/09)")).toBe(true);
    expect(text).toContain("*Total:* R$ 128,45 em 4 lançamentos");
    expect(text).toContain("*Dias com gasto:* 3 de 30");
    expect(text).toContain("*Maior dia:* 10/09, com R$ 55,00");
    expect(text).toContain("• 02/09: R$ 42,00 (2 lançamentos)");
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("sem gasto no período diz isso, sem inventar valor", () => {
    const empty = buildDailySeries([], { from: "2026-09-01", to: "2026-09-30", merchant: "Uber" });
    expect(dailySpendingSeriesText(empty)).toBe("Não encontrei gastos de *Uber* entre 01/09 a 30/09.");
  });

  it("gráfico tem um ponto por dia (dd/mm) e a mesma verdade do texto", () => {
    const result = uber();
    const artifact = buildDailySeriesChartArtifact(result);
    expect(artifact.title).toBe("Gastos dia a dia · Transporte no Uber");
    expect(artifact.chart.x_labels).toHaveLength(30);
    expect(artifact.chart.x_labels[0]).toBe("01/09");
    expect(artifact.chart.series[0].data.reduce((a, b) => a + b, 0)).toBeCloseTo(result.total, 2);
    expect(artifact.provenance.source).toBe("nino_daily_series.v1");
    expect(dailySeriesChartCaption(result).replace(/\u00a0/g, " ")).toContain("• Total gasto: R$ 128,45 em 4 lançamentos.");
  });
});

describe("IR: grão diário ponta a ponta", () => {
  function turnWith(operation: "sum" | "trend" | "value", groupBy: string[]): TaskTurnSpecV3 {
    return {
      version: "nino_turn_spec.v3",
      kind: "task",
      response_intent: "execute",
      act: "new_request",
      canonical_request: "gráfico diário de setembro de Transporte no Uber",
      inherit_topic: false,
      references: [],
      tasks: [{
        kind: "financial_query",
        family: "financial.query",
        metric: "expense_amount",
        operation,
        group_by: groupBy,
        filters: [
          { field: "category", entity: sourced("Transporte") },
          { field: "merchant", entity: sourced("Uber") },
        ],
        periods: [sourced("setembro")],
        limit: null,
        comparison: null,
      }],
    } as unknown as TaskTurnSpecV3;
  }

  it("grupo temporal sempre vira tendência (mês ou dia)", () => {
    expect(coherentOperation("sum", ["day"])).toBe("trend");
    expect(coherentOperation("value", ["month"])).toBe("trend");
    expect(coherentOperation("sum", ["category"])).toBe("breakdown");
  });

  it("sum + dia com categoria e estabelecimento passa nas invariantes e mantém os dois filtros", () => {
    for (const operation of ["sum", "trend", "value"] as const) {
      const turn = turnWith(operation, ["day"]);
      expect(verifySemanticInvariantsV3(turn).ok).toBe(true);
      const bridged = bridgeTurnSpecV3ToRuntime(turn, NOW);
      expect(bridged.ok).toBe(true);
      if (!bridged.ok) continue;
      const query = bridged.contract.financial_read?.queries[0];
      expect(query).toMatchObject({ operation: "trend", group_by: ["day"] });
      const fields = (query?.filters ?? []).map((f: { field: string }) => f.field).sort();
      expect(fields).toEqual(["category", "merchant"]);
    }
  });

  it("shape diário é reconhecido e não se confunde com o mensal", () => {
    const query = {
      metric: "expense_amount",
      grain: "day",
      reduce: "none",
      group_by: ["day"],
      filters: [
        { field: "category", op: "eq", value: "Transporte" },
        { field: "merchant", op: "eq", value: "Uber" },
      ],
      time: { aspect: "trend", from: "2026-09-01", to: "2026-09-30" },
    } as unknown as FinancialQueryV3;
    expect(isDailySeriesShape(query)).toBe(true);
    expect(isMonthlySeriesShape(query)).toBe(false);
    expect(isDailySeriesShape({ ...query, grain: "month", group_by: ["month"] } as FinancialQueryV3)).toBe(false);
    expect(isDailySeriesShape({ ...query, filters: [{ field: "account", op: "eq", value: "x" }] } as unknown as FinancialQueryV3)).toBe(false);
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
    expect(guardNarrative({ text: "O score de valor atual é alto em Alimentação.", pack, rules }).violations)
      .toContain("internal_jargon");
    expect(guardNarrative({ text: "Apareceu com confiança de 63% em Alimentação.", pack, rules }).violations)
      .toContain("internal_jargon");
    expect(guardNarrative({ text: "Você gastou 190.09 a mais em Alimentação.", pack, rules }).violations)
      .toContain("unformatted_number");
    const ok = guardNarrative({ text: "Alimentação passou do seu ritmo: R$ 190,09 acima do típico.", pack, rules });
    expect(ok.violations).not.toContain("unformatted_number");
    expect(ok.violations).not.toContain("internal_jargon");
  });
});

import { readFileSync } from "node:fs";

describe("interpretação de séries e follow-ups curtos", () => {
  const prompt = readFileSync("supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts", "utf8");
  it("pedido diário vira trend + group_by=[day] com os dois filtros", () => {
    expect(prompt).toContain("operation=trend e group_by=[day]");
    expect(prompt).toContain("Nunca use group_by=[month] para um pedido diário");
  });
  it("estabelecimento novo não herda categoria de outro assunto; follow-up curto herda filtros", () => {
    expect(prompt).toContain("merchant=Thales SÓ (sem category=Lazer)");
    expect(prompt).toContain("NÃO peça esclarecimento de categoria/estabelecimento");
  });
  it("séries saem diagramadas: o compositor só escreve a abertura e a lista vai inteira", () => {
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(core).toContain('"spending_timeseries_daily_scoped"');
    expect(core).toMatch(/compose_kind: laidOut\s*\?\s*"layout"/);
  });
});
