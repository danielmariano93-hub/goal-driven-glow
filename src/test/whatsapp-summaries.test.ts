import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { buildWeeklySummary } from "../../supabase/functions/_shared/summaries/weekly";
import { buildMonthlySummary } from "../../supabase/functions/_shared/summaries/monthly";
import { compareCents } from "../../supabase/functions/_shared/summaries/compare";
import { brl, clamp, mondayOf, rangeLabel } from "../../supabase/functions/_shared/summaries/format";
import { PHRASES, rank, type Candidate } from "../../supabase/functions/_shared/summaries/editorial";
import { renderSummaryPdf } from "../../supabase/functions/_shared/summaries/render";
import { TEXT_LIMITS, type SummaryDTO } from "../../supabase/functions/_shared/summaries/types";
import { monthlyInput, weeklyInput, weeklyRows } from "./fixtures/summaryFixtures";

const cents = (v: number) => Math.round(v * 100);
const sum = (xs: number[]) => xs.reduce((s, x) => s + cents(x), 0);
const limits = (d: SummaryDTO) => {
  expect(d.title.length).toBeLessThanOrEqual(TEXT_LIMITS.title);
  expect(d.insight.title.length).toBeLessThanOrEqual(TEXT_LIMITS.title);
  expect(d.insight.body.length).toBeLessThanOrEqual(TEXT_LIMITS.insight);
  expect(d.action.body.length).toBeLessThanOrEqual(TEXT_LIMITS.action);
  expect((d.caveat ?? "").length).toBeLessThanOrEqual(TEXT_LIMITS.caveat);
};

describe("formatação e comparação", () => {
  it("reais em pt-BR com centavos e sinal", () => {
    expect(brl(123456)).toBe("R$ 1.234,56");
    expect(brl(-5)).toBe("-R$ 0,05");
    expect(brl(1000, { sign: true })).toBe("+R$ 10,00");
  });
  it("regras de comparabilidade", () => {
    expect(compareCents(1000, null, "vs. x").text).toBe("sem comparação");
    expect(compareCents(null, 1000, "vs. x").text).toBe("não disponível");
    expect(compareCents(0, 0, "vs. x").text).toBe("sem variação");
    expect(compareCents(5000, 0, "vs. x", { spend: true }).text).toBe("novo gasto vs. x");
    const pct = compareCents(12000, 10000, "vs. x");
    expect(pct).toMatchObject({ delta_cents: 2000, delta_pct: 0.2, text: "+R$ 20,00 (+20%) vs. x" });
    // Troca de sinal: só reais, nunca porcentagem.
    const sc = compareCents(-3000, 5000, "vs. x");
    expect(sc.delta_pct).toBeNull();
    expect(sc.text).toBe("-R$ 80,00 vs. x");
    // Base negativa: sem porcentagem.
    expect(compareCents(-1000, -3000, "vs. x").delta_pct).toBeNull();
  });
  it("semana que cruza mês e ano", () => {
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
    expect(rangeLabel("2026-12-28", "2027-01-03")).toBe("28/12/2026 a 03/01/2027");
    expect(rangeLabel("2026-10-26", "2026-11-01")).toBe("26/10 a 01/11");
    expect(rangeLabel("2026-11-16", "2026-11-22")).toBe("16 a 22/11");
  });
  it("corte de texto não quebra palavra", () => {
    expect(clamp("uma frase bem comprida para cortar", 20)).toBe("uma frase bem…");
  });
});

describe("resumo semanal — reconciliação em centavos", () => {
  const d = buildWeeklySummary(weeklyInput());
  it("consumo da semana = soma das linhas da semana (com estorno)", () => {
    const week = weeklyRows.filter((r) => r.day >= "2026-11-16" && r.day < "2026-11-23").map((r) => r.amount);
    expect(d.hero.amount_cents).toBe(sum(week));
    expect(d.hero.amount_cents).toBe(52865);
    const prev = weeklyRows.filter((r) => r.day >= "2026-11-09" && r.day < "2026-11-16").map((r) => r.amount);
    expect(d.hero.reference_amount_cents).toBe(sum(prev));
    expect(d.hero.delta_cents).toBe(52865 - 34960);
    expect(d.is_partial).toBe(false);
    expect(d.period_end_exclusive).toBe("2026-11-23");
    expect(d.as_of).toBe("2026-11-22");
  });
  it("mês até a data compara os mesmos dias do mês anterior", () => {
    const mtd = d.kpis.find((k) => k.id === "mtd_consumption")!;
    expect(mtd.amount_cents).toBe(sum(weeklyRows.filter((r) => r.day >= "2026-11-01" && r.day <= "2026-11-22").map((r) => r.amount)));
    expect(mtd.reference_amount_cents).toBe(sum(weeklyRows.filter((r) => r.day >= "2026-10-01" && r.day <= "2026-10-22").map((r) => r.amount)));
  });
  it("categorias: top 3 em ordem, barras válidas, estorno abate a categoria", () => {
    expect(d.categories.map((c) => c.name)).toEqual(["Mercado", "Restaurantes", "Transporte"]);
    expect(d.categories[0].amount_cents).toBe(cents(231.75 + 112.6 - 40));
    expect(d.categories[0].bar).toBe(1);
  });
  it("pequenos gastos e saldo", () => {
    expect(d.kpis.find((k) => k.id === "small_spend")!.amount_cents).toBe(cents(48.9 + 23.9 + 35 + 27.5));
    const bal = d.kpis.find((k) => k.id === "account_balance")!;
    expect(bal.delta_cents).toBe(cents(4210.37) - cents(4785.12));
    expect(bal.delta_pct).toBeCloseTo(-0.1201, 3);
  });
  it("vencimentos dos próximos 7 dias depois do corte", () => {
    const up = d.future.find((l) => l.label.startsWith("Vencimentos"))!;
    expect(up.value).toBe(brl(cents(1287.44 + 119.9)));
  });
  it("insight determinístico: alta material de consumo → revisar a categoria que mais subiu", () => {
    expect(d.insight.kind).toBe("consumption_change");
    expect(d.action.title).toBe("Revise os gastos com Mercado");
    expect(d.insight.body).toContain("Mercado (+R$ 150,05)");
    limits(d);
  });
  it("risco de caixa domina: hero vira menor saldo previsto", () => {
    const r = buildWeeklySummary(weeklyInput({ future: { ...weeklyInput().future, minBalance: { amount: -312.4, date: "2026-11-28" } } }));
    expect(r.hero.id).toBe("projected_min_balance");
    expect(r.hero.tone).toBe("risk");
    expect(r.insight.kind).toBe("cash_risk");
    expect(r.action.title).toBe("Reserve R$ 312,40 até 28/11");
    expect(r.metrics.some((m) => m.id === "weekly_consumption" && m.amount_cents === 52865)).toBe(true);
  });
  it("semana a semana: blocos de 7 dias somam o acumulado do mês; mês anterior nos mesmos dias", () => {
    const wb = d.week_bars!;
    expect(wb.bars.map((b) => b.label)).toEqual(["1–7", "8–14", "15–21", "22–28", "29–30"]);
    const mtd = d.kpis.find((k) => k.id === "mtd_consumption")!;
    expect(wb.total_current_cents).toBe(mtd.amount_cents);
    expect(wb.total_previous_cents).toBe(mtd.reference_amount_cents);
    expect(wb.bars[3]).toMatchObject({ current_cents: cents(27.5), partial: true });
    expect(wb.bars[4].current_cents).toBeNull();
    expect(wb.bars[0].previous_cents).toBe(cents(420 + 1800));
  });
  it("destaque traz o acumulado do mês e o saldo de hoje (o mesmo da tela inicial)", () => {
    expect(d.hero_row[0]).toMatchObject({ label: "Acumulado em novembro", value: brl(d.kpis[0].amount_cents!) });
    expect(d.hero_row[1].label).toBe("Saldo em conta hoje");
    expect(d.hero_row[1].value).toBe("R$ 4.210,37");
    expect(d.hero_row[1].note).toContain("tela inicial");
  });
  it("semana parcial compara os mesmos dias", () => {
    const p = buildWeeklySummary(weeklyInput({ asOf: "2026-11-18" }));
    expect(p.is_partial).toBe(true);
    expect(p.as_of).toBe("2026-11-18");
    expect(p.hero.comparison_label).toBe("vs. mesmos 3 dias da semana anterior");
    expect(p.hero.amount_cents).toBe(cents(231.75 + 48.9 + 89));
    expect(p.hero.reference_amount_cents).toBe(cents(154.3 + 64));
  });
  it("sem lançamentos: frase própria, nunca zero inventado de comparação", () => {
    const e = buildWeeklySummary(weeklyInput({ rows: [] }));
    expect(e.insight.rule_id).toBe("W.no_data");
    expect(e.hero.amount_cents).toBe(0);
    expect(e.hero.delta_text).toBe("sem comparação");
    expect(e.categories_empty).toContain("Nenhum lançamento");
  });
  it("semana com base zero mostra 'novo gasto'", () => {
    const rows = [...weeklyRows.filter((r) => r.day < "2026-11-09"), ...weeklyRows.filter((r) => r.day >= "2026-11-16")];
    const z = buildWeeklySummary(weeklyInput({ rows }));
    expect(z.hero.delta_text).toBe("novo gasto vs. 7 dias anteriores");
  });
  it("sem saldo de conta: nulo, não zero", () => {
    const n = buildWeeklySummary(weeklyInput({ balances: { today: null, monthOpening: null } }));
    const bal = n.kpis.find((k) => k.id === "account_balance")!;
    expect(bal.amount_cents).toBeNull();
    expect(bal.status).toBe("unavailable");
    expect(n.quality_flags).toContain("no_balance");
  });
  it("semana que vira o ano", () => {
    const rows = [{ id: "a", day: "2026-12-30", amount: 100, category: "Mercado", small: false }, { id: "b", day: "2027-01-02", amount: 50, category: "Mercado", small: true }];
    const y = buildWeeklySummary(weeklyInput({ rows, weekStart: "2026-12-28", asOf: "2027-01-04" }));
    expect(y.title).toBe("Resumo da semana · 28/12/2026 a 03/01/2027");
    expect(y.hero.amount_cents).toBe(15000);
    expect(y.kpis[0].label).toBe("Consumo em janeiro");
    expect(y.kpis[0].amount_cents).toBe(5000);
  });
});

describe("resumo mensal — reconciliação", () => {
  const d = buildMonthlySummary(monthlyInput());
  it("resultado = receitas − consumo; Δ em reais, sem %", () => {
    expect(d.hero.amount_cents).toBe(cents(7250) - cents(5912.48));
    expect(d.hero.delta_cents).toBe(cents(1337.52) - cents(524.7));
    expect(d.hero.delta_pct).toBeNull();
    expect(d.is_partial).toBe(false);
    expect(d.title).toBe("Resumo de outubro de 2026");
  });
  it("troca de sinal do resultado não mostra porcentagem", () => {
    const s = buildMonthlySummary(monthlyInput({ cur: { ...monthlyInput().cur, consumption: 7600, result: -350 } }));
    expect(s.hero.delta_text).toBe(`${brl(-35000 - 52470, { sign: true })} vs. setembro`);
    expect(s.hero.tone).toBe("risk");
  });
  it("categorias top 3 e evolução", () => {
    expect(d.categories.map((c) => c.name)).toEqual(["Moradia", "Mercado", "Restaurantes"]);
    expect(d.categories[0].delta_text).toBe("sem variação");
    expect(d.evolution!.lines[1].value).toBe("2 de 3");
    expect(d.evolution!.lines[0].value).toBe("R$ 4.920,18");
    expect(d.evolution!.bars).toHaveLength(6);
  });
  it("próximo mês: compromissos e relação com a renda; recebíveis vencidos à parte", () => {
    expect(d.future[0].value).toBe("R$ 3.412,90");
    expect(d.future[1].value).toBe("49%");
    expect(d.future[2].note).toContain("R$ 180,00 já vencidos");
  });
  it("insight: meta estourada (prioridade 5) ganha de melhora sustentada (6)", () => {
    expect(d.insight.kind).toBe("goal_risk");
    expect(d.insight.title).toContain("Lazer");
    limits(d);
  });
  it("pressão de compromissos ≥ 50% da renda vem antes", () => {
    const p = buildMonthlySummary(monthlyInput({ next: { ...monthlyInput().next, commitments: 4200 } }));
    expect(p.insight.kind).toBe("commitment_pressure");
    expect(p.action.title).toBe("Separe R$ 4.200,00 para os vencimentos de novembro");
  });
  it("importação pendente: fechamento parcial", () => {
    const p = buildMonthlySummary(monthlyInput({ quality: { pendingImports: true, uncategorizedShare: 0, notes: [] } }));
    expect(p.is_partial).toBe(true);
    expect(p.insight.kind).toBe("data_quality");
    expect(p.caveat).toContain("Fechamento parcial");
  });
  it("renda ainda não recebida marca o resultado como parcial", () => {
    const p = buildMonthlySummary(monthlyInput({ cur: { ...monthlyInput().cur, resultPartial: true } }));
    expect(p.hero.status).toBe("partial");
    expect(p.quality_flags).toContain("income_pending");
  });
  it("mês em andamento: sem comparar com o mês anterior inteiro; renda pendente não vira prejuízo", () => {
    const o = buildMonthlySummary(monthlyInput({ month: "2026-11", asOf: "2026-11-26", cur: { income: 0, consumption: 5186.49, result: -5186.49, resultPartial: true, endBalance: 3870.03, debtPaid: 2388.57, hasEntries: true }, open: { expectedIncome: { amount: 9430.44, date: "2026-11-27" }, prevSameDaysConsumption: 8000 } }));
    expect(o.hero.label).toBe("Resultado até agora");
    expect(o.hero.tone).toBe("attention");
    expect(o.hero.delta_text).toBe("renda de R$ 9.430,44 prevista para 27/11 ainda não entrou");
    expect(o.hero.reference_amount_cents).toBeNull();
    expect(o.hero_row[0].note).toBe("renda de R$ 9.430,44 prevista para 27/11 ainda não entrou");
    expect(o.hero_row[1].note).toBe(`${brl(518649 - 800000, { sign: true })} vs. 1 a 26/10`);
    expect(o.hero_side.label).toBe("Mês em andamento");
  });
  it("fevereiro: comparação com janeiro e fim em 01/03", () => {
    const f = buildMonthlySummary(monthlyInput({ month: "2027-02", asOf: "2027-03-02" }));
    expect(f.period_end_exclusive).toBe("2027-03-01");
    expect(f.comparison_start).toBe("2027-01-01");
    expect(f.hero.comparison_label).toBe("vs. janeiro");
  });
  it("sem mês anterior: 'sem comparação'", () => {
    const n = buildMonthlySummary(monthlyInput({ prev: null }));
    expect(n.kpis[0].delta_text).toBe("sem comparação");
    expect(n.quality_flags).toContain("no_history");
  });
});

describe("prioridade e desempate", () => {
  const base = (o: Partial<Candidate>): Candidate => ({ kind: "opportunity", phrase: "opportunity", vars: {}, tone: "neutral", severity: 0, deadline: null, impactCents: 0, evidence: 0.5, id: "x", ...o });
  it("ordem fixa, depois severidade, prazo, impacto, evidência e ID", () => {
    const xs = [base({ id: "b", kind: "goal_risk" }), base({ id: "a", kind: "cash_risk" }), base({ id: "c", kind: "goal_risk", severity: 2 })];
    expect([...xs].sort(rank).map((x) => x.id)).toEqual(["a", "c", "b"]);
    const ys = [base({ id: "z", deadline: "2026-12-01" }), base({ id: "y", deadline: "2026-11-30" })];
    expect([...ys].sort(rank)[0].id).toBe("y");
    const zs = [base({ id: "q", impactCents: -900 }), base({ id: "p", impactCents: 500 })];
    expect([...zs].sort(rank)[0].id).toBe("q");
    expect([base({ id: "m" }), base({ id: "l" })].sort(rank)[0].id).toBe("l");
  });
  it("biblioteca de frases sem chaves soltas", () => {
    for (const p of Object.values(PHRASES)) for (const t of Object.values(p)) expect(t).not.toMatch(/\{\s*\}/);
  });
});

describe("PDF", () => {
  const out = process.env.SUMMARY_PREVIEW_DIR;
  const cases: Array<[string, SummaryDTO]> = [
    ["resumo-semanal", buildWeeklySummary(weeklyInput())],
    ["resumo-mensal", buildMonthlySummary(monthlyInput({ rows: weeklyRows }))],
    ["resumo-semanal-risco", buildWeeklySummary(weeklyInput({ future: { ...weeklyInput().future, minBalance: { amount: -312.4, date: "2026-11-28" } } }))],
    ["resumo-semanal-vazio", buildWeeklySummary(weeklyInput({ rows: [], balances: { today: null, monthOpening: null } }))],
    ["resumo-mensal-parcial", buildMonthlySummary(monthlyInput({ quality: { pendingImports: true, uncategorizedShare: 0, notes: [] } }))],
    ["resumo-mensal-oportunidade", buildMonthlySummary(monthlyInput({ goals: null, prev: { ...monthlyInput().prev!, consumption: 5900, result: 1080 }, opportunity: { title: "Revise os gastos com Restaurantes e delivery no fim de semana", body: "Você gastou em média R$ 1.834 por mês com Restaurantes nos últimos meses; o seu padrão mais baixo recorrente foi R$ 1.194. A diferença é de cerca de R$ 640 por mês.", basis: "Baseline: R$ 1.194 no mesmo período do mês anterior. Premissa: voltar a esse nível (diferença de R$ 640).", impact: 640 } }))],
  ];
  it("oportunidade: ação em linguagem direta, sem termos técnicos", () => {
    const d = cases.find(([n]) => n === "resumo-mensal-oportunidade")![1];
    expect(d.insight.kind).toBe("opportunity");
    expect(d.action.body).not.toMatch(/Baseline|Premissa/);
    expect(d.insight.body.length).toBeLessThanOrEqual(180);
  });
  for (const [name, dto] of cases) {
    it(`${name}: uma página, < 1 MB, sem texto cortado`, async () => {
      const r = await renderSummaryPdf(dto);
      expect(r.pages).toBe(1);
      expect(r.sizeBytes).toBeLessThan(1024 * 1024);
      expect(r.issues).toEqual([]);
      const head = Buffer.from(r.bytes.slice(0, 5)).toString();
      expect(head).toBe("%PDF-");
      if (out) { mkdirSync(out, { recursive: true }); writeFileSync(`${out}/${name}.pdf`, r.bytes); }
    });
  }
});
