import { describe, expect, it } from "vitest";
import { resolvePeriodPt } from "../../supabase/functions/_shared/analytics/periodResolver";
import { multiPeriodText, periodSumValue, wantsPeriodSum } from "../../supabase/functions/_shared/agent/core/MultiPeriodAnswer";

const NOW = new Date("2026-11-09T15:00:00Z");

describe("mês retrasado", () => {
  it("resolve para dois meses atrás, inteiro", () => {
    expect(resolvePeriodPt("quanto recebi no mês retrasado?", NOW)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "mês retrasado", complete: true });
  });
  it("vira o ano: em janeiro, o mês retrasado é novembro do ano anterior", () => {
    expect(resolvePeriodPt("e no mes retrasado", new Date("2026-01-10T15:00:00Z"))).toMatchObject({ from: "2025-11-01", to: "2025-11-30" });
  });
  it("não atrapalha 'mês passado' nem 'semana passada'", () => {
    expect(resolvePeriodPt("quanto gastei no mês passado?", NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriodPt("e semana retrasada?", NOW)).toMatchObject({ kind: "week", complete: true });
  });
});

describe("soma de vários meses", () => {
  const ok = (id: string, total: number) => ({ query_id: id, engine: "x", status: "ok", result: { total_metric: total, metric: "expense", headline: `Você gastou R$ ${total} nesse período.` } });
  const args = {
    outcomes: [ok("q#0", 2336.47), ok("q#1", 2074.15), ok("q#2", 2101.07)],
    labels: { "q#0": "agosto", "q#1": "setembro", "q#2": "outubro" },
    periodOrder: ["agosto", "setembro", "outubro"],
    comparison_intent: false,
  };
  it("reconhece o pedido de soma, mas não uma pergunta qualquer", () => {
    for (const t of ["somando agosto, setembro e outubro, quanto eu gastei?", "quanto gastei com mercado em outubro e em setembro juntos?", "no total, de agosto a outubro", "soma de agosto e setembro", "juntando agosto e setembro, qual o total de gastos?", "totalizando os três meses"]) {
      expect(wantsPeriodSum(t), t).toBe(true);
    }
    for (const t of ["quanto gastei em agosto, setembro e outubro?", "gastei mais em agosto ou setembro?"]) {
      expect(wantsPeriodSum(t), t).toBe(false);
    }
  });
  it("a soma é a dos totais já executados, arredondada em centavos", () => {
    expect(periodSumValue(args)).toBe(6511.69);
  });
  it("com a soma pedida, o texto traz cada mês e o total", () => {
    const text = multiPeriodText({ ...args, sum_intent: true })!;
    expect(text).toContain("Somando os três períodos: R$ 6.511,69.");
  });
  it("sem pedir a soma, o texto continua só com cada mês", () => {
    expect(multiPeriodText({ ...args, sum_intent: false })).not.toContain("Somando");
  });
  it("não soma em silêncio quando um período ficou sem total", () => {
    const partial = { ...args, outcomes: [ok("q#0", 100), { query_id: "q#1", engine: "x", status: "ok", result: { metric: "expense", headline: "Você gastou algo nesse período." } }, ok("q#2", 50)] };
    expect(periodSumValue(partial)).toBeNull();
    expect(multiPeriodText({ ...partial, sum_intent: true }) ?? "").not.toContain("Somando");
  });
});

import { withExplicitMonthRange } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";

describe("média mensal entre meses nomeados", () => {
  const typical: any = {
    id: "q1", metric: "expense_amount", grain: "month", reduce: "typical", group_by: [], filters: [],
    time: { aspect: "habitual", from: "2026-04-01", to: "2026-10-31", n: 6, exclude_partial: true, label: "últimos 6 meses completos" },
  };
  it("usa o intervalo dito (agosto a outubro, 3 meses) e a média, não a janela padrão de 6 meses", () => {
    const q = withExplicitMonthRange(typical, "qual foi minha média de gasto por mês entre agosto e outubro?", NOW);
    expect(q.time).toMatchObject({ aspect: "last_n_complete", from: "2026-08-01", to: "2026-10-31", n: 3 });
    expect(q.reduce).toBe("mean");
  });
  it("sem 'média' no texto mantém o tipo de redução", () => {
    expect(withExplicitMonthRange(typical, "quanto eu gasto por mês de agosto a outubro?", NOW).reduce).toBe("typical");
  });
  it("sem intervalo nomeado, não mexe (ex.: 'últimos 3 meses' e o hábito padrão)", () => {
    expect(withExplicitMonthRange(typical, "quanto eu gasto por mês?", NOW)).toBe(typical);
    expect(withExplicitMonthRange(typical, "média dos últimos 3 meses", NOW)).toBe(typical);
  });
  it("não mexe em consultas que não são o gasto típico mensal", () => {
    const other: any = { ...typical, metric: "income_amount" };
    expect(withExplicitMonthRange(other, "média entre agosto e outubro", NOW)).toBe(other);
  });
});
