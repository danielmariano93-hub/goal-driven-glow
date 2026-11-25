import { describe, expect, it } from "vitest";
import { buildFutureView, buildReportStory, isDisplayableMerchant, storyApplies } from "@/lib/engine/reportStory";
import type { DashEntry } from "@/lib/engine/reportDashboard";

const ex = (date: string, amount: number, category: string, merchant: string | null = null, extra: Partial<DashEntry> = {}): DashEntry => ({
  date, kind: "expense", amount, category_id: `c-${category}`, category, merchant_key: merchant, merchant: merchant, ...extra,
});
const inc = (date: string, amount: number): DashEntry => ({ date, kind: "income", amount, category_id: null, category: "Salário", merchant_key: null, merchant: null });

// Três meses de referência (ago, set, out/2026): moradia 1000 no dia 5; uber 100 no dia 10; delivery 100 no dia 12; mercado 200 no dia 3.
const month = (m: string) => [
  ex(`${m}-03`, 200, "Mercado", "mercado"), ex(`${m}-05`, 1000, "Moradia", "aluguel"),
  ex(`${m}-10`, 100, "Transporte", "uber"), ex(`${m}-12`, 100, "Alimentação", "ifood"),
  inc(`${m}-05`, 5000),
];
const base = [...month("2026-08"), ...month("2026-09"), ...month("2026-10")];

// Novembro até o dia 24: uber 250 (+150), delivery 220 (+120), moradia 1000, mercado 200.
const nov = [
  ex("2026-11-03", 200, "Mercado", "mercado"), ex("2026-11-05", 1000, "Moradia", "aluguel"),
  ex("2026-11-10", 250, "Transporte", "uber"), ex("2026-11-12", 220, "Alimentação", "ifood"),
  inc("2026-11-05", 5000),
];
const essentials = ["c-Moradia", "c-Mercado"];
const story = (over: Partial<Parameters<typeof buildReportStory>[0]> = {}) =>
  buildReportStory({ entries: [...base, ...nov], today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: essentials, ...over });

describe("report_story.v1", () => {
  it("só existe para um mês de calendário", () => {
    expect(storyApplies("2026-11-01", "2026-11-24")).toBe(true);
    expect(storyApplies("2026-10-25", "2026-11-24")).toBe(false);
    expect(storyApplies("2026-09-01", "2026-11-24")).toBe(false);
    expect(buildReportStory({ entries: [...base, ...nov], today: "2026-11-24", start: "2026-09-01", end: "2026-11-24", essentialCategoryIds: [] })).toBeNull();
  });

  it("habitual = média dos 3 meses fechados na mesma janela de dias", () => {
    const s = story()!;
    expect(s.habitual).toMatchObject({ expense: 1400, months: ["2026-08", "2026-09", "2026-10"] });
    expect(s.habitual!.deltaAbs).toBe(270); // 1670 - 1400
    expect(s.habitual!.deltaPct).toBeCloseTo(0.193, 3);
  });

  it("sem 2 meses de histórico não existe habitual (nem curva, variação ou ação)", () => {
    const s = story({ entries: [...month("2026-10"), ...nov] })!;
    expect(s.habitual).toBeNull();
    expect(s.cumulative).toBeNull();
    expect(s.variations).toEqual([]);
    expect(s.action).toBeNull();
  });

  it("curva acumulada termina no total e no habitual", () => {
    const s = story()!;
    const last = s.cumulative![s.cumulative!.length - 1];
    expect(last).toEqual({ day: 24, current: 1670, habitual: 1400 });
    expect(s.cumulative![0]).toEqual({ day: 1, current: 0, habitual: 0 });
  });

  it("janela de dias: gasto depois do dia pedido não entra no habitual", () => {
    const late = [...base, ex("2026-10-28", 900, "Lazer", "cinema"), ...nov];
    expect(buildReportStory({ entries: late, today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: essentials })!.habitual!.expense).toBe(1400);
  });

  it("variações por estabelecimento: só o que subiu de verdade, com valor e %", () => {
    const s = story()!;
    expect(s.variations.map((v) => v.label)).toEqual(["uber", "ifood"]);
    expect(s.variations[0]).toMatchObject({ total: 250, habitual: 100, deltaAbs: 150, deltaPct: 1.5, essential: false });
    // aluguel e mercado não mudaram: ficam de fora
    expect(s.variations.find((v) => v.label === "aluguel")).toBeUndefined();
  });

  it("essenciais x ajustáveis exige categorias marcadas", () => {
    expect(story()!.split).toMatchObject({ essential: 1200, adjustable: 470 });
    expect(story({ essentialCategoryIds: [] })!.split).toBeNull();
    expect(story({ essentialCategoryIds: [] })!.recoverable).toBeNull();
  });

  it("gasto recuperável soma o excesso só de categorias ajustáveis, e a ação é o maior", () => {
    const s = story()!;
    expect(s.recoverable!.amount).toBe(270);
    expect(s.action).toMatchObject({ merchant: "uber", excess: 150, total: 250, habitual: 100 });
    expect(s.action!.reductionPct).toBe(0.6);
  });

  it("ação nunca recai sobre categoria essencial", () => {
    const s = story({ essentialCategoryIds: ["c-Transporte", "c-Moradia"] })!;
    expect(s.action!.merchant).toBe("ifood");
  });

  it("poupança sustentável = renda média - gasto médio dos meses fechados", () => {
    expect(story()!.sustainableSavings).toEqual({ monthly: 3600, avgIncome: 5000, avgExpense: 1400, months: 3 });
  });

  it("dia da semana: média por dia, destaque de fim de semana só quando pesa 20%+", () => {
    // 2026-11-07 é sábado; 2026-11-08 domingo
    const weekend = [...nov, ex("2026-11-07", 3000, "Lazer", "bar"), ex("2026-11-08", 3000, "Lazer", "bar")];
    const s = buildReportStory({ entries: [...base, ...weekend], today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: essentials })!;
    expect(s.weekday!.rows).toHaveLength(7);
    expect(s.weekday!.weekend).not.toBeNull();
    expect(s.weekday!.weekend!.pct).toBeGreaterThanOrEqual(0.2);
    // antes do dia 14 não há amostra suficiente por dia da semana
    expect(story({ end: "2026-11-10" })!.weekday).toBeNull();
  });

  it("compra de cartão de fatura anterior (carregada) não vira gasto de um dia da semana", () => {
    const carried = [...nov, ex("2026-11-09", 900, "Lazer", "loja", { chart_carried: true })];
    const s = buildReportStory({ entries: [...base, ...carried], today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: essentials })!;
    const monday = s.weekday!.rows[0];
    const withoutCarried = buildReportStory({ entries: [...base, ...nov], today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: essentials })!.weekday!.rows[0];
    expect(monday.avg).toBe(withoutCarried.avg);
  });
});

describe("futuro (snapshot da Home)", () => {
  const snapshot = {
    availableToday: 2100, projectedMonthEndAvailable: 1800,
    commitmentAgenda: {
      horizonStart: "2026-11-24", horizonEnd: "2026-12-24", hasEstimates: true,
      pendingItems: [
        { date: "2026-11-28", type: "expense", amount: 700, source: "card_statement" },
        { date: "2026-12-02", type: "expense", amount: 250, source: "card_installment" },
        { date: "2026-12-10", type: "expense", amount: 700, source: "debt_installment" },
        { date: "2026-12-05", type: "expense", amount: 1200, source: "recurring" },
        { date: "2027-01-05", type: "expense", amount: 999, source: "recurring" }, // fora do horizonte
        { date: "2026-12-01", type: "income", amount: 100, source: "planned" },
      ],
    },
    goalProgress: [{ id: "g1", name: "Viagem", target: 8000, contributed: 0 }, { id: "g2", name: "Reserva de emergência", target: 15000, contributed: 9400 }, { id: "g3", name: "Dizimo", target: 1, contributed: 0 }],
  };
  const SAVINGS = ["g1", "g2"];

  it("agrupa compromissos de 30 dias e ignora o que está fora do horizonte", () => {
    const f = buildFutureView(snapshot, "2026-11-24", 200, SAVINGS)!;
    expect(f.commitments!.total).toBe(2850);
    expect(f.commitments!.groups).toEqual([
      { key: "cards", label: "Parcelas e fatura do cartão", amount: 950 },
      { key: "debts", label: "Dívidas", amount: 700 },
      { key: "recurring", label: "Recorrências e planejados", amount: 1200 },
    ]);
    expect(f.balance).toBe(2100);
    expect(f.projectedEndBalance).toBe(1800);
  });

  it("a receber soma pessoas e entradas agendadas", () => {
    expect(buildFutureView(snapshot, "2026-11-24", 200, SAVINGS)!.receivable).toEqual({ total: 300, fromPeople: 200, scheduled: 100 });
    expect(buildFutureView({ ...snapshot, commitmentAgenda: { ...snapshot.commitmentAgenda, pendingItems: [] } }, "2026-11-24", 0, SAVINGS)!.receivable).toBeNull();
  });

  it("meta prefere reserva de emergência e calcula progresso real", () => {
    expect(buildFutureView(snapshot, "2026-11-24", 0, SAVINGS)!.goal).toEqual({ name: "Reserva de emergência", target: 15000, contributed: 9400, remaining: 5600, pct: 0.627 });
  });

  it("sem meta ou sem compromissos, o bloco some (null), nunca zero inventado", () => {
    const f = buildFutureView({ availableToday: 10, commitmentAgenda: { pendingItems: [] }, goalProgress: [] }, "2026-11-24", 0, SAVINGS)!;
    expect(f.commitments).toBeNull();
    expect(f.goal).toBeNull();
    expect(f.receivable).toBeNull();
    expect(buildFutureView(null, "2026-11-24", 0, SAVINGS)).toBeNull();
  });
});

describe("dados reais: casos que já apareceram na conta", () => {
  it("meta de doação (dízimo, alvo R$1) nunca vira a meta do relatório", () => {
    const snap = { availableToday: 1, commitmentAgenda: { pendingItems: [] }, goalProgress: [{ id: "d", name: "Dizimo", target: 1, contributed: 0 }] };
    expect(buildFutureView(snap, "2026-11-24", 0, ["g-savings-only"])!.goal).toBeNull();
    expect(buildFutureView(snap, "2026-11-24", 0, [])!.goal).toBeNull();
  });

  it("um mês atípico (setembro com renda e fatura enormes) não puxa habitual nem poupança", () => {
    const m = (ym: string, income: number, big: number) => [
      ex(`${ym}-03`, 200, "Mercado", "mercado"), ex(`${ym}-05`, big, "Moradia", "aluguel"), inc(`${ym}-05`, income),
    ];
    const entries = [...m("2026-08", 8500, 1000), ...m("2026-09", 24000, 3800), ...m("2026-10", 8300, 1000), ex("2026-11-03", 200, "Mercado", "mercado"), ex("2026-11-05", 1000, "Moradia", "aluguel")];
    const s = buildReportStory({ entries, today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: [] })!;
    expect(s.habitual!.expense).toBe(1200); // mediana, não a média (2067)
    expect(s.sustainableSavings).toMatchObject({ avgIncome: 8500, avgExpense: 1200, monthly: 7300 });
  });

  it("salário que ainda não caiu: renda marcada como incompleta, não 'resultado negativo'", () => {
    const month = (ym: string) => [ex(`${ym}-03`, 300, "Mercado", "mercado"), inc(`${ym}-05`, 8000)];
    const entries = [...month("2026-08"), ...month("2026-09"), ...month("2026-10"), ex("2026-11-03", 300, "Mercado", "mercado")];
    const s = buildReportStory({ entries, today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: [] })!;
    expect(s.income).toEqual({ current: 0, typical: 8000, incomplete: true });
    const paid = buildReportStory({ entries: [...entries, inc("2026-11-05", 8000)], today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: [] })!;
    expect(paid.income!.incomplete).toBe(false);
    // mês fechado nunca é "incompleto"
    expect(buildReportStory({ entries, today: "2026-12-05", start: "2026-11-01", end: "2026-11-30", essentialCategoryIds: [] })!.income!.incomplete).toBe(false);
  });

  it("dia da semana ignora essenciais (parcela de dívida de R$ 3,7 mil não vira 'dia mais caro')", () => {
    const entries = [...base, ...nov, ex("2026-11-18", 3700, "Moradia", "banco")]; // 18/11/2026 = quarta
    const withFlags = buildReportStory({ entries, today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: essentials })!;
    expect(withFlags.weekday!.scope).toBe("adjustable");
    expect(withFlags.weekday!.rows[2].avg).toBe(0);
    const noFlags = buildReportStory({ entries, today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: [] })!;
    expect(noFlags.weekday!.scope).toBe("all");
    expect(noFlags.weekday!.rows[2].avg).toBeGreaterThan(900);
  });
});

describe("nomes exibidos", () => {
  it("PIX para pessoa e descrição longa de intermediário não viram estabelecimento", () => {
    expect(isDisplayableMerchant("Uber")).toBe(true);
    expect(isDisplayableMerchant("Souk4u")).toBe(true);
    expect(isDisplayableMerchant("Zé Delivery")).toBe(true);
    expect(isDisplayableMerchant("Pix Alex")).toBe(false);
    expect(isDisplayableMerchant("Pix enviado Michael Carlos Silva De Morais")).toBe(false);
    expect(isDisplayableMerchant("Pagamento De Pix Qr Code 99pay Sociedade De Credito")).toBe(false);
    expect(isDisplayableMerchant("")).toBe(false);
    expect(isDisplayableMerchant(null)).toBe(false);
  });

  it("variação de PIX recorrente para pessoa não aparece nem vira ação", () => {
    const month = (ym: string) => [ex(`${ym}-10`, 100, "Outros", "pix alex", { merchant: "Pix Alex" }), ex(`${ym}-12`, 100, "Lazer", "bar", { merchant: "Bar" })];
    const entries = [...month("2026-08"), ...month("2026-09"), ...month("2026-10"), ex("2026-11-10", 400, "Outros", "pix alex", { merchant: "Pix Alex" }), ex("2026-11-12", 220, "Lazer", "bar", { merchant: "Bar" })];
    const s = buildReportStory({ entries, today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: ["c-Moradia"] })!;
    expect(s.variations.map((v) => v.label)).toEqual(["Bar"]);
    expect(s.action!.merchant).toBe("Bar");
  });
});

describe("coerência com o motor clássico do relatório", () => {
  it("o 'Você consumiu' do painel é o mesmo número da curva, das categorias e do habitual", async () => {
    const { buildReportDashboard } = await import("@/lib/engine/reportDashboard");
    const entries = [...base, ...nov, ex("2026-11-20", 80, "Lazer", "cinema"), { ...ex("2026-11-21", -40, "Lazer", "cinema") }];
    const dash = buildReportDashboard(entries, { today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", compare: "previous" });
    const s = buildReportStory({ entries, today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: essentials })!;
    const last = s.cumulative![s.cumulative!.length - 1];
    expect(last.current).toBeCloseTo(dash.totals.expense, 2);
    // soma das categorias (todas) = total
    expect(s.categories.reduce((a, c) => a + c.total, 0)).toBeLessThanOrEqual(dash.totals.expense + 0.01);
    // o delta do hero parte do mesmo total
    expect(s.habitual!.deltaAbs).toBeCloseTo(dash.totals.expense - s.habitual!.expense, 2);
    // estorno (valor negativo) não entra como gasto, igual ao painel
    expect(dash.totals.expense).toBeCloseTo(1670 + 80, 2);
  });
});

describe("qualidade do dado, preços que subiram, saldo do mês e metas de gasto", () => {
  const sub = (ym: string, amount: number) => ex(`${ym}-10`, amount, "Serviços", "claro", { merchant: "Claro" });
  const usage = (ym: string, n: number) => Array.from({ length: n }, (_, i) => ex(`${ym}-${String(3 + i).padStart(2, "0")}`, 30, "Transporte", "uber", { merchant: "Uber" }));
  const run = (entries: DashEntry[]) => buildReportStory({ entries, today: "2026-11-24", start: "2026-11-01", end: "2026-11-24", essentialCategoryIds: [] })!;

  it("gasto sem categoria: valor e proporção do mês", () => {
    const s = run([...base, ...nov, { ...ex("2026-11-15", 300, "x"), category_id: null }]);
    expect(s.quality).toMatchObject({ uncategorizedAmount: 300, habitualMonths: 3 });
    expect(s.quality!.uncategorizedShare).toBeCloseTo(300 / 1970, 3);
  });

  it("assinatura que subiu aparece com de/para e diferença", () => {
    const s = run([...base, ...nov, sub("2026-08", 202.59), sub("2026-09", 194.79), sub("2026-10", 202.59), sub("2026-11", 234.61)]);
    expect(s.priceChanges).toHaveLength(1);
    expect(s.priceChanges[0]).toMatchObject({ label: "Claro", from: 202.59, to: 234.61, deltaAbs: 32.02 });
    expect(s.priceChanges[0].deltaPct).toBeCloseTo(0.158, 3);
  });

  it("uso variável (várias cobranças) e variações pequenas não viram 'preço que subiu'", () => {
    const heavy = run([...base, ...nov, ...usage("2026-08", 4), ...usage("2026-09", 4), ...usage("2026-10", 4), ...usage("2026-11", 9)]);
    expect(heavy.priceChanges).toEqual([]);
    const tiny = run([...base, ...nov, sub("2026-08", 100), sub("2026-09", 100), sub("2026-10", 100), sub("2026-11", 102)]);
    expect(tiny.priceChanges).toEqual([]);
    const oneMonth = run([...base, ...nov, sub("2026-10", 100), sub("2026-11", 150)]);
    expect(oneMonth.priceChanges).toEqual([]);
  });

  it("valor que já oscilava muito antes, ou salto grande demais, não conta como reajuste", () => {
    expect(run([...base, ...nov, sub("2026-08", 100), sub("2026-09", 150), sub("2026-10", 100), sub("2026-11", 140)]).priceChanges).toEqual([]);
    // 100 -> 250 (+150%) é outra compra, não o mesmo preço
    expect(run([...base, ...nov, sub("2026-08", 100), sub("2026-09", 100), sub("2026-10", 100), sub("2026-11", 250)]).priceChanges).toEqual([]);
  });

  const snap = {
    availableToday: 4791, commitmentAgenda: { pendingItems: [] }, goalProgress: [],
    projection: { freeAfterKnownCommitments: 12100.7, projectedEndBalance: 11817.94, estimatedIncomeEvents: [
      { date: "2026-11-10", label: "Já passou", amount: 1, source: "estimated" },
      { date: "2026-11-27", label: "Renda informada no perfil", amount: 9430.44, source: "configured" }] },
    activeCategoryGoals: [
      { goal: { id: "g1" }, categoryName: "Transporte", status: "on_track", period: { start: "2026-11-01", end: "2026-11-30" }, targetAmount: 958.61, actualSpend: 512.49, projectedSpend: 668.37, daysRemaining: 5 },
      { goal: { id: "g2" }, categoryName: "Lazer", status: "exceeded", period: { start: "2026-11-01", end: "2026-11-30" }, targetAmount: 500, actualSpend: 600, projectedSpend: 700, daysRemaining: 5 },
      { goal: { id: "g3" }, categoryName: "Alimentação", status: "completed_ok", period: { start: "2026-10-01", end: "2026-10-31" }, targetAmount: 400, actualSpend: 90 },
      { goal: { id: "g4" }, categoryName: "Pets", status: "scheduled", period: { start: "2026-12-01", end: "2026-12-31" }, targetAmount: 100, actualSpend: 0 }],
  };

  it("saldo do mês: livre depois de pagar tudo, saldo previsto e a próxima renda (só futura)", () => {
    const f = buildFutureView(snap, "2026-11-24", 0, [])!;
    expect(f.outlook).toEqual({ freeAfterCommitments: 12100.7, projectedEnd: 11817.94, expectedIncome: { amount: 9430.44, date: "2026-11-27", label: "Renda informada no perfil", source: "configured" } });
  });

  it("sem projeção no snapshot, o bloco some", () => {
    expect(buildFutureView({ availableToday: 1, commitmentAgenda: { pendingItems: [] }, goalProgress: [] }, "2026-11-24", 0, [])!.outlook).toBeNull();
  });

  it("metas de gasto: só as que valem hoje, a mais usada primeiro, estourada passa de 100%", () => {
    const g = buildFutureView(snap, "2026-11-24", 0, [])!.spendingGoals;
    expect(g.map((x) => x.category)).toEqual(["Lazer", "Transporte"]);
    expect(g[0]).toMatchObject({ pct: 1.2, status: "exceeded", spent: 600, limit: 500 });
    expect(g[1]).toMatchObject({ pct: 0.535, projected: 668.37, daysRemaining: 5 });
  });
});
