import { describe, expect, it } from "vitest";
import { buildFutureView, buildReportStory, storyApplies } from "@/lib/engine/reportStory";
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
    goalProgress: [{ name: "Viagem", target: 8000, contributed: 0 }, { name: "Reserva de emergência", target: 15000, contributed: 9400 }],
  };

  it("agrupa compromissos de 30 dias e ignora o que está fora do horizonte", () => {
    const f = buildFutureView(snapshot, "2026-11-24", 200)!;
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
    expect(buildFutureView(snapshot, "2026-11-24", 200)!.receivable).toEqual({ total: 300, fromPeople: 200, scheduled: 100 });
    expect(buildFutureView({ ...snapshot, commitmentAgenda: { ...snapshot.commitmentAgenda, pendingItems: [] } }, "2026-11-24", 0)!.receivable).toBeNull();
  });

  it("meta prefere reserva de emergência e calcula progresso real", () => {
    expect(buildFutureView(snapshot, "2026-11-24", 0)!.goal).toEqual({ name: "Reserva de emergência", target: 15000, contributed: 9400, remaining: 5600, pct: 0.627 });
  });

  it("sem meta ou sem compromissos, o bloco some (null), nunca zero inventado", () => {
    const f = buildFutureView({ availableToday: 10, commitmentAgenda: { pendingItems: [] }, goalProgress: [] }, "2026-11-24", 0)!;
    expect(f.commitments).toBeNull();
    expect(f.goal).toBeNull();
    expect(f.receivable).toBeNull();
    expect(buildFutureView(null, "2026-11-24", 0)).toBeNull();
  });
});
