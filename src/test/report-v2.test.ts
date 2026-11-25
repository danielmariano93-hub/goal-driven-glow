import { describe, expect, it } from "vitest";
import { buildReportV2, classifyLedger, isDisplayableMerchant, median, type V2Entry, type V2Inputs } from "@/lib/engine/reportV2";

const structural = (n: string) => /aluguel|energia|moradia/i.test(n);
let seq = 0;
const exp = (date: string, amount: number, category: string | null, extra: Partial<V2Entry> = {}): V2Entry => ({
  id: `t${++seq}`, date, kind: "expense", amount, category_id: category ? `c-${category}` : null, category: category ?? "Sem categoria",
  merchant_key: extra.merchant_key ?? null, merchant: extra.merchant ?? null, ...extra,
});
const inc = (date: string, amount: number, category = "Salário"): V2Entry => ({ id: `i${++seq}`, date, kind: "income", amount, category_id: null, category, merchant_key: null, merchant: null });

function base(entries: V2Entry[], over: Partial<V2Inputs> = {}): V2Inputs {
  return {
    today: "2026-11-24", month: "2026-11", compare: "previous", entries, debtSplits: {}, isStructuralCategory: structural,
    profile: null, snapshot: null, monthlyFact: null, receivables: [], commitmentMonths: [], patterns: [], situationActions: [], savingsGoalIds: [], netWorthSeries: [], ...over,
  };
}

/** Três meses de histórico: aluguel 1000 + mercado 400 + lazer 200 no dia 5/10/15. */
function history(): V2Entry[] {
  const out: V2Entry[] = [];
  for (const m of ["2026-08", "2026-09", "2026-10"]) {
    out.push(exp(`${m}-02`, 1000, "Aluguel"), exp(`${m}-10`, 400, "Mercado"), exp(`${m}-15`, 200, "Lazer"), inc(`${m}-05`, 5000));
  }
  return out;
}

describe("report_v2 — consumo canônico", () => {
  it("as classes somam exatamente o consumo e estorno abate", () => {
    const e = [...history(), exp("2026-11-02", 1000, "Aluguel"), exp("2026-11-08", 300, "Mercado"), exp("2026-11-09", 80, null), exp("2026-11-10", -50, "Mercado")];
    const r = buildReportV2(base(e));
    const o = r.overview!;
    expect(o.consumption).toBe(1330);
    const sum = o.classes.estrutural + o.classes.ajustavel + o.classes.extraordinario + o.classes.nao_classificado;
    expect(sum).toBe(o.consumption);
    expect(o.classes.nao_classificado).toBe(80);
    expect(o.refunds).toBe(50);
  });

  it("dívida: principal sai do consumo, juros entram, pagamento sem separação fica fora e é declarado", () => {
    const e = [...history(), { ...exp("2026-11-03", 1000, "Dívida"), id: "d1", debt_payment: true }, { ...exp("2026-11-04", 500, "Dívida"), id: "d2", debt_payment: true }, exp("2026-11-06", 100, "Mercado")];
    const r = buildReportV2(base(e, { debtSplits: { d1: { principal: 900, interest: 100 } } }));
    expect(r.overview!.consumption).toBe(200); // 100 de juros + 100 de mercado
    expect(r.overview!.debtPaid).toBe(1400); // 900 + 500 inteiro
    expect(r.quality.some((q) => q.code === "debt_unsplit")).toBe(true);
  });

  it("compra muito acima do padrão vira extraordinária", () => {
    const e: V2Entry[] = [];
    for (const m of ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) for (let d = 1; d <= 8; d += 1) e.push(exp(`${m}-${String(d).padStart(2, "0")}`, 40 + d, "Mercado"));
    e.push(exp("2026-11-05", 3200, "Lazer"));
    const cls = classifyLedger(e, {}, structural, "2026-11");
    expect(cls.rows.find((x) => x.amount === 3200)?.klass).toBe("extraordinario");
  });

  it("habitual é a mediana dos meses anteriores na mesma janela", () => {
    const r = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel"), exp("2026-11-10", 700, "Mercado")]));
    expect(r.overview!.habitual!.value).toBe(1600); // 1000 + 400 + 200 (lazer dia 15 ainda não entra até o dia 24? entra)
  });

  it("sem renda do mês o resultado fica em aberto, não negativo", () => {
    const r = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")]));
    expect(r.overview!.income.incomplete).toBe(true);
    expect(r.overview!.result).toEqual({ value: -1000, partial: true, reason: "income_pending" });
    const withIncome = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel"), inc("2026-11-05", 5000)]));
    expect(withIncome.overview!.result.value).toBe(4000);
  });

  it("habitual não existe com menos de 2 meses de base", () => {
    const r = buildReportV2(base([exp("2026-10-02", 100, "Mercado"), exp("2026-11-02", 100, "Mercado")]));
    expect(r.overview!.habitual).toBeNull();
    expect(r.quality.some((q) => q.code === "habitual_thin")).toBe(true);
  });
});

describe("report_v2 — contrato de composição (auditoria)", () => {
  it("estorno sem categoria entra na soma: as partes fecham 100% do consumo", () => {
    const e = [...history(), exp("2026-11-02", 1000, "Aluguel"), exp("2026-11-03", 600, "Lazer"), exp("2026-11-04", 80, null), { ...exp("2026-11-05", 0, null), kind: "expense" as const, amount: -300 }];
    const o = buildReportV2(base(e)).overview!;
    expect(o.classes.nao_classificado).toBe(-220);
    const parts = o.classes.estrutural + o.classes.ajustavel + o.classes.extraordinario + o.classes.nao_classificado;
    expect(Math.round(parts * 100)).toBe(Math.round(o.consumption * 100));
  });
  it("ponte do consumo fecha em centavos: despesas − estornos = consumo", () => {
    const e = [...history(), exp("2026-11-02", 1000.37, "Aluguel"), exp("2026-11-03", 599.99, "Lazer"), exp("2026-11-04", -49.5, "Lazer")];
    const o = buildReportV2(base(e)).overview!;
    expect(Math.round((o.reconciliation.gross - o.reconciliation.refunds) * 100)).toBe(Math.round(o.consumption * 100));
    expect(o.reconciliation.refunds).toBe(49.5);
  });
  it("resultado parcial mostra o valor e a renda prevista, sem esconder", () => {
    const snap = { availableToday: 100, projection: { estimatedIncomeEvents: [{ date: "2026-11-27", amount: 9430.44, source: "configured" }] } };
    const o = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")], { snapshot: snap })).overview!;
    expect(o.result.partial).toBe(true);
    expect(o.income.expected).toEqual({ amount: 9430.44, date: "2026-11-27" });
    expect(o.headline).toMatch(/parcial/);
  });
});

describe("report_v2 — comportamento", () => {
  it("categorias e estabelecimentos trazem comparação com o mês anterior", () => {
    const e = [
      ...history(),
      exp("2026-10-12", 100, "Lazer", { merchant_key: "cinema", merchant: "Cinemark" }),
      exp("2026-11-12", 250, "Lazer", { merchant_key: "cinema", merchant: "Cinemark" }),
      exp("2026-11-13", 30, "Lazer", { merchant_key: "pix", merchant: "Pix enviado João" }),
    ];
    const b = buildReportV2(base(e)).behavior!;
    const lazer = b.categories.find((c) => c.name === "Lazer")!;
    expect(lazer.total).toBe(280);
    expect(lazer.previous).toBe(300); // 200 histórico + 100 cinema
    const cine = b.merchants.find((m) => m.key === "cinema")!;
    expect(cine.previous).toBe(100);
    expect(cine.deltaPct).toBe(1.5);
    expect(b.merchants.some((m) => m.key === "pix")).toBe(false);
  });

  it("dia da semana divide pelo número de dias do tipo, incluindo dias sem gasto", () => {
    // Novembro de 2026 até o dia 24: 4 sábados (7,14,21 + ... ) -> conta pelos dias reais
    const e = [...history(), exp("2026-11-07", 140, "Lazer", { chart_date: "2026-11-07" })];
    const w = buildReportV2(base(e)).behavior!.weekday!;
    const sab = w.rows.find((r) => r.label === "Sáb")!;
    expect(sab.days).toBe(3); // 7, 14, 21
    expect(sab.avg).toBeCloseTo(140 / 3, 1);
    expect(w.rows.find((r) => r.label === "Seg")!.avg).toBe(0);
  });

  it("só considera padrões validados ou candidatos firmes, nunca compromisso recorrente", () => {
    const p = (label: string, status: string, conf: number) => ({ label, status, upliftPct: 30, absoluteDelta: 20, sampleSize: 12, confidence: conf, coverage: 1 });
    const r = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")], { patterns: [p("Sextas pesam mais", "validated", 0.8), p("Compromisso recorrente de aluguel", "validated", 0.9), p("Talvez", "candidate", 0.3)] }));
    expect(r.behavior!.patterns.map((x) => x.label)).toEqual(["Sextas pesam mais"]);
  });
});

describe("report_v2 — projeções", () => {
  const snapshot = {
    availableToday: 4791,
    projection: {
      currentAvailableBalance: 4791, estimatedIncomeEvents: [{ date: "2026-11-30", amount: 9430, source: "configured", confidence: "high", label: "Salário" }],
      confirmedFutureInflows: 0, upcomingConfirmedCommitments: 2100, cardDueThisMonth: 650, projectedVariableSpending: 0, projectedEndBalance: 11471,
    },
    commitmentAgenda: { horizonEnd: "2026-12-24", pendingItems: [
      { type: "expense", amount: 1200, date: "2026-11-28", source: "card_statement" }, { type: "expense", amount: 300, date: "2026-12-05", source: "recurring" },
    ] },
  };
  it("caixa fecha com a conta aberta (4.791 + 9.430 − 2.100 − 650 = 11.471)", () => {
    const r = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")], { snapshot }));
    const c = r.projections.cash!;
    expect(c.projectedEnd).toBe(11471);
    expect(c.reconciles).toBe(true);
    expect(c.steps.at(-1)!.value).toBe(11471);
  });
  it("compromissos: fatura do mês sem item na agenda entra como estimativa; renda comprometida usa a renda informada", () => {
    const s2 = { ...snapshot, projection: { ...snapshot.projection, estimatedFixedInflows: 9430.44, cardDueThisMonth: 259.8 },
      commitmentAgenda: { horizonEnd: "2026-12-25", pendingItems: [{ type: "expense", amount: 3732.9, date: "2026-11-27", source: "debt_installment" }, { type: "expense", amount: 309.94, date: "2026-12-03", source: "recurring" }] } };
    const r = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")], { snapshot: s2 }));
    const c = r.projections.commitments!;
    expect(c.groups.find((g) => g.key === "cards")).toEqual({ key: "cards", amount: 259.8, estimated: true });
    expect(c.next30).toBeCloseTo(4302.64, 2);
    expect(r.projections.committedIncome!.income).toBe(9430.44);
    expect(r.projections.committedIncome!.basis).toMatch(/informada/);
  });
  it("projeção de caixa em centavos reconcilia com a soma dos passos exibidos", () => {
    const s2 = { availableToday: 4791.12, projection: { currentAvailableBalance: 4791.12, estimatedIncomeEvents: [{ date: "2026-11-27", amount: 9430.44, source: "configured" }], upcomingConfirmedCommitments: 1861.06, cardDueThisMonth: 259.8, projectedVariableSpending: 282.76, projectedEndBalance: 11817.94 } };
    const c = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")], { snapshot: s2 })).projections.cash!;
    const [start, inc, ...rest] = c.steps;
    const total = start.value + inc.value - rest.filter((x) => x.sign === "minus").reduce((a, x) => a + x.value, 0);
    expect(Math.round(total * 100)).toBe(Math.round(c.projectedEnd * 100));
    expect(c.projectedEnd).toBe(11817.94);
  });
  it("renda não configurada fica fora do cenário conservador", () => {
    const s = { ...snapshot, projection: { ...snapshot.projection, estimatedIncomeEvents: [{ date: "2026-11-30", amount: 9430, source: "estimated", confidence: "medium" }] } };
    const c = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")], { snapshot: s })).projections.cash!;
    expect(c.conservativeEnd).toBe(c.projectedEnd - 9430);
  });
  it("a receber separa a vencer, vencido e recebido, e não entra no caixa", () => {
    const r = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")], { snapshot, receivables: [
      { balance: 300, dueDate: "2026-12-01", state: "pending", paidAmount: 0, paidAt: null },
      { balance: 100, dueDate: "2026-10-01", state: "overdue", paidAmount: 0, paidAt: null },
      { balance: 0, dueDate: "2026-11-01", state: "paid", paidAmount: 80, paidAt: "2026-11-10" },
    ] }));
    expect(r.projections.receivables).toEqual({ toDue: 300, overdue: 100, receivedInPeriod: 80, count: 2 });
    expect(r.projections.cash!.projectedEnd).toBe(11471);
  });
  it("sem retrato de hoje não inventa projeção de caixa", () => {
    const r = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")]));
    expect(r.projections.cash).toBeNull();
    expect(r.quality.some((q) => q.code === "snapshot_stale")).toBe(true);
  });
  it("poupança distingue zero real de histórico curto; recuperável soma o total", () => {
    const profile = (closed: number, saving: number) => ({ asOf: "2026-11-24", closedMonths: closed, incomeBaseline: 5000, savingsRateMedian: 0.1, sustainableMonthlySaving: saving, recoverableMonthly: 300, netWorth: 1000, confidence: "medium",
      flexibleSources: [{ label: "Lazer", baseline_monthly: 100, observed_monthly: 300, recoverable_monthly: 200 }, { label: "Beleza", baseline_monthly: 50, observed_monthly: 150, recoverable_monthly: 50 }] });
    const e = [...history(), exp("2026-11-02", 1000, "Aluguel")];
    expect(buildReportV2(base(e, { profile: profile(4, 0) })).projections.savings!.status).toBe("zero_real");
    expect(buildReportV2(base(e, { profile: profile(1, 0) })).projections.savings!.status).toBe("insufficient_history");
    const rec = buildReportV2(base(e, { profile: profile(4, 200) })).projections.recoverable!;
    expect(rec.sources.reduce((s, x) => s + x.monthly, 0)).toBeCloseTo(300, 1);
  });
});

describe("report_v2 — evolução e recomendações", () => {
  it("mês em aberto sem renda não tem resultado; meses fechados têm", () => {
    const r = buildReportV2(base([...history(), exp("2026-11-02", 1000, "Aluguel")]));
    const months = r.evolution.months;
    expect(months.find((m) => m.month === "2026-10")!.result).toBe(3400);
    const open = months.find((m) => m.month === "2026-11")!;
    expect(open.partial).toBe(true);
    expect(open.result).toBe(-1000);
  });
  it("recomendações ordenadas por impacto×confiança, com total anual e sem duplicar alvo", () => {
    const e = [...history(),
      ...[1, 2, 3, 4].map((d) => exp(`2026-10-0${d}`, 25, "Lazer", { merchant_key: "ifd", merchant: "iFood" })),
      ...[1, 2, 3, 4, 5, 6, 7].map((d) => exp(`2026-11-0${d}`, 60, "Lazer", { merchant_key: "ifd", merchant: "iFood" })),
    ];
    const rec = buildReportV2(base(e)).recommendations;
    expect(rec.items[0].title).toMatch(/iFood/);
    expect(rec.items.length).toBeLessThanOrEqual(3);
    expect(rec.items.every((i) => i.basis.length > 0)).toBe(true);
    expect("monthlyTotal" in rec).toBe(false); // sem agregado: as ações se sobrepõem
    const scores = rec.items.map((i) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe("utilitários", () => {
  it("mediana", () => { expect(median([1, 5, 3])).toBe(3); expect(median([1, 3])).toBe(2); expect(median([])).toBe(0); });
  it("estabelecimento reconhecível", () => {
    expect(isDisplayableMerchant("iFood")).toBe(true);
    expect(isDisplayableMerchant("Pix enviado Maria")).toBe(false);
  });
});
