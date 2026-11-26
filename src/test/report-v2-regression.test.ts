/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { toLedger } from "../../supabase/functions/_shared/insights/executive/load";
import { buildReportV2, isDebtCategoryName, type V2Entry, type V2Inputs } from "@/lib/engine/reportV2";

// Regressão da auditoria: cada cenário percorre o livro canônico (toLedger) e o relatório, em centavos.
const cats = new Map([["c-mercado", "Mercado"], ["c-div", "Dívidas e empréstimos"], ["c-lazer", "Lazer"]]);
let n = 0;
const tx = (o: Record<string, unknown>) => ({ id: `t${++n}`, status: "confirmed", type: "expense", movement_kind: "transaction", amount: 0, occurred_at: "2026-11-10", payment_method: "account", ...o });
const ledger = (rows: any[]) => toLedger(rows, cats, [], { from: "2026-05-01", to: "2026-11-30" }, { includeDebtPayments: true }) as unknown as V2Entry[];
const input = (entries: V2Entry[], over: Partial<V2Inputs> = {}): V2Inputs => ({
  today: "2026-11-24", month: "2026-11", compare: "previous", entries, debtSplits: {}, isStructuralCategory: () => false,
  profile: null, snapshot: null, monthlyFact: null, receivables: [], commitmentMonths: [], patterns: [], situationActions: [], savingsGoalIds: [], netWorthSeries: [], ...over,
});
const hist = (): any[] => ["2026-08", "2026-09", "2026-10"].flatMap((m) => [tx({ amount: 1000, category_id: "c-mercado", occurred_at: `${m}-05` }), tx({ type: "income", movement_kind: "transaction", amount: 5000, occurred_at: `${m}-05` })]);
const cents = (v: number) => Math.round(v * 100);

describe("regressão — livro canônico e relatório", () => {
  it("transferência própria e pagamento de fatura não são consumo", () => {
    const e = ledger([...hist(), tx({ amount: 700, category_id: "c-mercado" }), tx({ amount: 300, movement_kind: "transfer", transfer_group_id: "g1" }), tx({ amount: 900, movement_kind: "card_payment", settles_card_id: "card1" })]);
    expect(buildReportV2(input(e)).overview!.consumption).toBe(700);
  });
  it("estorno vinculado abate o consumo da categoria original", () => {
    const orig = tx({ id: "orig", amount: 400, category_id: "c-lazer" });
    const e = ledger([...hist(), orig, tx({ type: "income", movement_kind: "refund", refund_of_transaction_id: "orig", amount: 150, category_id: null })]);
    const r = buildReportV2(input(e));
    expect(r.overview!.consumption).toBe(250);
    expect(r.overview!.reconciliation).toMatchObject({ gross: 400, refunds: 150, consumption: 250 });
  });
  it("empréstimo: principal fora, juros conhecidos dentro; sem separação, nada de juros inventados", () => {
    const e = ledger([...hist(), tx({ id: "d1", amount: 1100, movement_kind: "debt_payment", category_id: "c-div" }), tx({ id: "d2", amount: 500, movement_kind: "debt_payment", category_id: "c-div" })]);
    const r = buildReportV2(input(e, { debtSplits: { d1: { principal: 1000, interest: 100 } } }));
    expect(r.overview!.consumption).toBe(100);
    expect(r.overview!.debt.paid).toBe(1500);
    expect(r.overview!.debt.items.find((d) => d.label && d.amount === 500)!.split).toBe(false);
    expect(r.quality.find((q) => q.code === "debt_unsplit")!.affects).toContain("01 Consumo");
  });
  it("categoria de dívida sem registro de pagamento de dívida é gasto comum (igual à ponte do caixa)", () => {
    expect(isDebtCategoryName("Dívidas e empréstimos")).toBe(true);
    expect(isDebtCategoryName("Mercado")).toBe(false);
    const e = ledger([...hist(), tx({ amount: 649.48, category_id: "c-div" }), tx({ amount: 80, category_id: "c-mercado" })]);
    const r = buildReportV2(input(e));
    expect(r.overview!.consumption).toBe(729.48);
    expect(r.overview!.debt.items).toHaveLength(0);
    expect(r.overview!.debtPaid).toBe(0);
  });
  it("categoria de dívida com registro em debt_payments continua pagamento de dívida", () => {
    const rows = [...hist(), tx({ id: "pix-div", amount: 649.48, category_id: "c-div" }), tx({ amount: 80, category_id: "c-mercado" })];
    const r = buildReportV2(input(ledger(rows), { debtSplits: { "pix-div": { principal: 600, interest: 49.48 } } }));
    expect(r.overview!.debtPaid).toBe(600);
    expect(r.overview!.debt.items[0]).toMatchObject({ fromCategory: true, split: true });
    expect(r.overview!.consumption).toBe(129.48);
  });
  it("parcela antecipada no cartão vai para o mês em que venceria, não para o da fatura", () => {
    const e = ledger([...hist(), tx({ amount: 300, category_id: "c-lazer", payment_method: "credit_card", credit_card_id: "k1", occurred_at: "2026-10-20", competence_date: "2026-11-05", economic_competence_date: "2026-10-05", installment_anticipated: true })]);
    const r = buildReportV2(input(e));
    expect(r.overview?.consumption ?? 0).toBe(0); // pertence a outubro
    const oct = buildReportV2(input(e, { month: "2026-10", today: "2026-11-24" }));
    expect(oct.overview!.consumption).toBe(1300);
  });
  it("renda atrasada: resultado parcial, nunca negativo definitivo", () => {
    const e = ledger([...hist(), tx({ amount: 1000, category_id: "c-mercado" })]);
    const r = buildReportV2(input(e));
    expect(r.overview!.result).toMatchObject({ partial: true, value: -1000 });
  });
  it("recebível vencido não entra no caixa nem some do pendente; recebido no mês não compõe o pendente", () => {
    const e = ledger([...hist(), tx({ amount: 100, category_id: "c-mercado" })]);
    const r = buildReportV2(input(e, { receivables: [
      { balance: 4380, dueDate: "2026-12-10", state: "pending", paidAmount: 0, paidAt: null },
      { balance: 1057.3, dueDate: "2026-10-01", state: "overdue", paidAmount: 0, paidAt: null },
      { balance: 0, dueDate: "2026-11-01", state: "paid", paidAmount: 906, paidAt: "2026-11-12" },
    ] }));
    expect(r.projections.receivables).toEqual({ toDue: 4380, overdue: 1057.3, receivedInPeriod: 906, count: 2 });
  });
  it("histórico incompleto: sem habitual e com aviso, nunca zero inventado", () => {
    const e = ledger([tx({ amount: 100, category_id: "c-mercado", occurred_at: "2026-11-03" })]);
    const r = buildReportV2(input(e));
    expect(r.overview!.habitual).toBeNull();
    expect(r.quality.some((q) => q.code === "habitual_none")).toBe(true);
  });
  it("categorias sobrepostas: cada real cai em uma classe só, em centavos, com estorno sem categoria", () => {
    const e = ledger([...hist(), tx({ amount: 333.33, category_id: "c-mercado" }), tx({ amount: 12.34, category_id: null }), tx({ type: "income", movement_kind: "refund", amount: 45.67, category_id: null })]);
    const o = buildReportV2(input(e)).overview!;
    const parts = o.classes.estrutural + o.classes.ajustavel + o.classes.extraordinario + o.classes.nao_classificado;
    expect(cents(parts)).toBe(cents(o.consumption));
    expect(cents(o.reconciliation.gross - o.reconciliation.refunds)).toBe(cents(o.consumption));
  });
  it("sinais: frequência crescente aparece com evidência e amostra; sem amostra mínima, não aparece", () => {
    const old = ["2026-10-03", "2026-10-09"].map((d) => tx({ amount: 30, category_id: "c-lazer", occurred_at: d }));
    const now = Array.from({ length: 8 }, (_, i) => tx({ amount: 40, category_id: "c-lazer", occurred_at: `2026-11-${String(i + 2).padStart(2, "0")}` }));
    const sig = buildReportV2(input(ledger([...hist(), ...old, ...now]))).behavior!.signals;
    expect(sig[0]).toMatchObject({ key: "freq:Lazer", confidence: "media" });
    expect(sig[0].evidence).toMatch(/8 compras/);
    const few = buildReportV2(input(ledger([...hist(), ...old, ...now.slice(0, 3)]))).behavior!.signals;
    expect(few.filter((x) => x.key.startsWith("freq"))).toEqual([]);
  });
  it("fim de semana: o padrão só é firme quando se repete nos meses de referência", () => {
    const sat = (d: string) => tx({ amount: 400, category_id: "c-lazer", occurred_at: d }); // sábados
    const rows = [...hist(), ...["2026-08-08", "2026-09-05", "2026-10-03", "2026-11-07"].map(sat)];
    const w = buildReportV2(input(ledger(rows), { isStructuralCategory: (n) => n === "Mercado" })).behavior!.weekday!;
    expect(w.persistence).toEqual({ months: 3, withPattern: 3 });
    expect(w.sample.days).toBe(24);
  });
  it("ponte do caixa: saldo inicial derivado + entradas − saídas = saldo de hoje, transferência própria fora", () => {
    const snap = { availableToday: 4791.12, projection: { estimatedIncomeEvents: [] } };
    const cashMovements = [
      { dir: "in" as const, key: "in_external", amount: 7796.31 }, { dir: "in" as const, key: "in_refund", amount: 814.91 }, { dir: "in" as const, key: "in_invest", amount: 0.12 },
      { dir: "out" as const, key: "out_spend", amount: 3734.52 }, { dir: "out" as const, key: "out_debt", amount: 1739.09 }, { dir: "out" as const, key: "out_external", amount: 230 }, { dir: "out" as const, key: "out_card", amount: 10 },
    ];
    const r = buildReportV2(input(ledger([...hist(), tx({ amount: 100, category_id: "c-mercado" })]), { snapshot: snap, cashMovements }));
    const b = r.overview!.cashBridge!;
    const inn = b.inflows.reduce((t, x) => t + x.amount, 0); const out = b.outflows.reduce((t, x) => t + x.amount, 0);
    expect(cents(b.opening + inn - out)).toBe(cents(b.closing));
    expect(b.closing).toBe(4791.12);
    expect(b.opening).toBe(1893.39);
    expect(b.inflows.find((x) => x.label.includes("de fora"))!.amount).toBe(7796.31);
  });
  it("previsto x realizado: compara a última previsão do mês fechado com o consumo real", () => {
    const e = ledger([...hist(), tx({ amount: 100, category_id: "c-mercado" })]);
    const r = buildReportV2(input(e, { projectionHistory: [{ month: "2026-10", asOf: "2026-10-20", projectedConsumption: 1100, projectedEnd: 5000 }] }));
    expect(r.evolution.forecast[0]).toMatchObject({ month: "2026-10", predictedConsumption: 1100, actualConsumption: 1000, consumptionErrorPct: 0.1 });
  });
  it("ação aceita: some das recomendações e passa a ser medida contra o ponto de partida", () => {
    const rows = [...hist(),
      ...[1, 2, 3, 4].map((d) => tx({ amount: 25, category_id: "c-lazer", occurred_at: `2026-10-0${d}`, description: "iFood" })),
      ...[1, 2, 3, 4, 5].map((d) => tx({ amount: 30, category_id: "c-lazer", occurred_at: `2026-11-0${d}`, description: "iFood" }))];
    const entries = ledger(rows);
    const first = buildReportV2(input(entries));
    const merchant = first.behavior!.merchants[0];
    expect(merchant).toBeTruthy();
    const withAction = buildReportV2(input(entries, { recommendationActions: [{ month: "2026-11", recKey: `merchant:${merchant.key}`, kind: "merchant", title: "Voltar iFood", action: "accepted", merchantKey: merchant.key, category: "Lazer", baselineAmount: merchant.total + 100, monthlyImpact: 50 }] }));
    expect(withAction.recommendations.items.some((i) => i.key === `merchant:${merchant.key}`)).toBe(false);
    expect(withAction.evolution.tracked[0]).toMatchObject({ baseline: merchant.total + 100, current: merchant.total, status: "reduzindo" });
  });
});
