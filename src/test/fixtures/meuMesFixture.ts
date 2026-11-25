// Fixture do Meu mês: valores das capturas de 25/11 (handoff, seção 14) + histórico sintético. Não é dado certificado.
import { buildReportV2, type V2Entry } from "@/lib/engine/reportV2";

let n = 0;
const e = (date: string, amount: number, category: string | null, merchant: string | null = null, extra: Partial<V2Entry> = {}): V2Entry => ({ id: `x${++n}`, date, kind: "expense", amount, category_id: category ? `c-${category}` : null, category: category ?? "Sem categoria", merchant_key: merchant?.toLowerCase() ?? null, merchant, chart_date: date, ...extra });
const inc = (date: string, amount: number, category = "Salário"): V2Entry => ({ id: `i${++n}`, date, kind: "income", amount, category_id: null, category, merchant_key: null, merchant: null });
const entries: V2Entry[] = [];
// Novembro (valores reais por categoria)
entries.push(
  e("2026-11-24", 1053.92, "Serviços", "Reserva viagem", { chart_date: "2026-11-10" }), e("2026-11-12", 787, "Lazer", "Ingresso"), e("2026-11-24", 247.33, "Dívidas e empréstimos", "CREDITSEC"),
  e("2026-11-24", 341.62, "Dívidas e empréstimos", "99Pay"), e("2026-11-24", 60.53, "Dívidas e empréstimos", "99Pay"),
  ...Array.from({ length: 27 }, (_, i) => e(`2026-11-${String((i % 24) + 1).padStart(2, "0")}`, 18.98, "Transporte", "Uber")),
  ...Array.from({ length: 24 }, (_, i) => e(`2026-11-${String((i % 24) + 1).padStart(2, "0")}`, 18.7, "Alimentação", "iFood")),
  e("2026-11-05", 438.47, "Energia"), e("2026-11-18", 259.8, "Assinaturas", "Apple"), e("2026-11-20", 127.3, "Assinaturas", "Netflix"), e("2026-11-03", 169.8, "Vestuário", "Zara"),
  e("2026-11-08", 144, "Divisão do Rolê"), e("2026-11-10", 136.9, "Internet"), e("2026-11-11", 113.51, "Saúde"), e("2026-11-13", 100, "Outros"), e("2026-11-14", 50, "Beleza"), e("2026-11-15", 13.9, "Moradia"), e("2026-11-16", 12.94, "Seguros"),
  e("2026-11-06", 1566, "Dívidas e empréstimos", "Réveillon", { debt_payment: true, id: "d-rev" }), e("2026-11-24", 97.06, "Dívidas e empréstimos", "Banco Sim", { debt_payment: true, id: "d-sim" }), e("2026-11-24", 76.03, "Dívidas e empréstimos", "Banco Pan", { debt_payment: true, id: "d-pan" }),
  e("2026-11-02", -291.33, "Divisão Rolê"), e("2026-11-06", -116.12, "Divisão Rolê"), e("2026-11-08", -291.34, null), e("2026-11-11", -116.12, null),
);
// Histórico sintético (5 meses)
for (const m of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) {
  entries.push(e(`${m}-05`, 1900, "Moradia"), e(`${m}-07`, 600, "Energia"), e(`${m}-10`, 1500, "Alimentação", "iFood"), e(`${m}-12`, 1400, "Lazer", "Ingresso"), e(`${m}-14`, 900, "Transporte", "Uber"), e(`${m}-16`, 600, "Assinaturas"), e(`${m}-20`, 2000, "Serviços", "Reserva viagem"), e(`${m}-22`, 700, "Saúde"), e(`${m}-25`, 300, "Vestuário"));
  entries.push(inc(`${m}-05`, m === "2026-09" ? 24000 : 9604));
}
const snapshot = {
  availableToday: 4761.12,
  projection: { currentAvailableBalance: 4761.12, estimatedIncomeEvents: [{ date: "2026-11-27", amount: 9430.44, source: "configured", confidence: "high", label: "Renda informada no perfil" }], estimatedFixedInflows: 9430.44, confirmedFutureInflows: 0, upcomingConfirmedCommitments: 1861.06, cardDueThisMonth: 259.8, projectedVariableSpending: 287.36, projectedEndBalance: 11783.34, freeAfterKnownCommitments: 12070.7 },
  commitmentAgenda: { horizonEnd: "2026-12-25", pendingItems: [
    { type: "expense", amount: 500, date: "2026-11-27", source: "debt_installment", name: "Parcela Celular" }, { type: "expense", amount: 44.9, date: "2026-11-27", source: "recurring", name: "Netflix" },
    { type: "expense", amount: 1316.16, date: "2026-11-29", source: "debt_installment", name: "Parcela Crediário" }, { type: "expense", amount: 103.4, date: "2026-12-03", source: "recurring", name: "ChatGPT" },
    { type: "expense", amount: 1566, date: "2026-12-09", source: "debt_installment", name: "Parcela Réveillon" }, { type: "expense", amount: 89.9, date: "2026-12-11", source: "recurring", name: "Wellhub" },
    { type: "expense", amount: 12.94, date: "2026-12-13", source: "recurring", name: "Seguro" }, { type: "expense", amount: 34.9, date: "2026-12-18", source: "recurring", name: "Apple" }, { type: "expense", amount: 23.9, date: "2026-12-18", source: "recurring", name: "Spotify" },
    { type: "expense", amount: 350.4, date: "2026-12-04", source: "debt_installment", name: "Parcelas diversas" } ] },
  netWorth: { net: -57577.62, cash: 4761.12, owed: 66067.79, assets: 8490.17, invested: 3699.05, cardsOwed: 259.8, otherDebts: 65807.99 },
  activeCategoryGoals: [
    { goal: { id: "g1" }, categoryName: "Transporte", targetAmount: 958.61, actualSpend: 512.49, projectedSpend: 668.37, daysRemaining: 5, status: "on_track", period: { start: "2026-11-01", end: "2026-11-30" } },
    { goal: { id: "g2" }, categoryName: "Alimentação", targetAmount: 681.77, actualSpend: 478.73, projectedSpend: 588.32, daysRemaining: 5, status: "on_track", period: { start: "2026-11-01", end: "2026-11-30" } },
    { goal: { id: "g3" }, categoryName: "Lazer", targetAmount: 1044.67, actualSpend: 787, projectedSpend: 945.99, daysRemaining: 5, status: "on_track", period: { start: "2026-11-01", end: "2026-11-30" } },
    { goal: { id: "g4" }, categoryName: "Assinaturas", targetAmount: 551.48, actualSpend: 387.1, projectedSpend: 432, daysRemaining: 5, status: "on_track", period: { start: "2026-11-01", end: "2026-11-30" } } ],
  goalProgress: [{ id: "s1", name: "Reserva de emergência", target: 10000, contributed: 1800 }],
};
const STRUCT = /moradia|energia|internet|saúde|seguro|assinatura|dívid/i;
export const report = buildReportV2({
  today: "2026-11-25", month: "2026-11", compare: "previous", entries,
  debtSplits: { "d-rev": { principal: 1566, interest: 0 }, "d-sim": { principal: 97.06, interest: 0 }, "d-pan": { principal: 76.03, interest: 0 } },
  isStructuralCategory: (name) => STRUCT.test(name),
  profile: { asOf: "2026-11-25", closedMonths: 5, incomeBaseline: 9604, savingsRateMedian: -0.2, sustainableMonthlySaving: 0, recoverableMonthly: 723, netWorth: -57577.62, confidence: "medium", flexibleSources: [{ label: "Assinaturas", baseline_monthly: 200, observed_monthly: 575, recoverable_monthly: 375 }, { label: "Lazer", baseline_monthly: 900, observed_monthly: 1161, recoverable_monthly: 261 }, { label: "Beleza", baseline_monthly: 0, observed_monthly: 60, recoverable_monthly: 60 }, { label: "Vestuário", baseline_monthly: 0, observed_monthly: 27, recoverable_monthly: 27 }] },
  snapshot, monthlyFact: { accountIn: 20000, accountOut: 12000, externalIn: 7796, externalOut: 230 },
  receivables: [{ balance: 4380, dueDate: "2026-12-10", state: "pending", paidAmount: 0, paidAt: null }, { balance: 1057.3, dueDate: "2026-10-01", state: "overdue", paidAmount: 0, paidAt: null }, { balance: 0, dueDate: "2026-11-01", state: "paid", paidAmount: 906, paidAt: "2026-11-12" }],
  commitmentMonths: [["2026-12", 0, 3900, 310], ["2027-01", 640, 3700, 310], ["2027-02", 640, 3200, 310], ["2027-03", 320, 2800, 310], ["2027-04", 0, 2400, 310], ["2027-05", 0, 2000, 310]].map(([month, cards, debts, recurring]) => ({ month: month as string, cards: cards as number, debts: debts as number, recurring: recurring as number })),
  patterns: [{ label: "Sextas e sábados pesam mais", status: "validated", upliftPct: 40, absoluteDelta: 80, sampleSize: 18, confidence: 0.8, coverage: 1 }],
  situationActions: [{ key: "plan_ahead", title: "Planejar agora", explanation: "Organize o caixa antes da data prevista", impact: 1566, route: "/app/planejamento", confidence: 0.9, detail: "A parcela de Tia é de R$ 1.566,00 e vence em 09/12.", dueDate: "2026-12-09" }],
  cashMovements: [{ dir: "in", key: "in_external", amount: 7796.31 }, { dir: "in", key: "in_refund", amount: 814.91 }, { dir: "in", key: "in_invest", amount: 0.12 }, { dir: "out", key: "out_spend", amount: 3734.52 }, { dir: "out", key: "out_debt", amount: 1739.09 }, { dir: "out", key: "out_external", amount: 230 }, { dir: "out", key: "out_card", amount: 10 }],
  projectionHistory: [{ month: "2026-10", asOf: "2026-10-20", projectedConsumption: 11200, projectedEnd: 3100 }, { month: "2026-09", asOf: "2026-09-18", projectedConsumption: 9800, projectedEnd: 1200 }],
  recommendationActions: [{ month: "2026-10", recKey: "merchant:uber", kind: "merchant", title: "Voltar Uber ao nível anterior", action: "accepted", merchantKey: "uber", category: "Transporte", baselineAmount: 900, monthlyImpact: 200 } as never],
  savingsGoalIds: ["s1"], netWorthSeries: [{ month: "2026-08", value: -48000 }, { month: "2026-09", value: -52000 }, { month: "2026-10", value: -55200 }, { month: "2026-11", value: -57577.62 }],
});
