import { describe, it, expect } from "vitest";
import { buildMapaReading } from "@/lib/engine/mapaReading";
import { validateMapaReading, type MapaIndicator, type MapaReading, type MapaRecommendationFeedback, type MapaStoredReading } from "@/lib/engine/mapaContracts";
import type { MapaMonthlyEntry } from "@/lib/engine/mapaMonthly";
import type { MapaDebtIn, MapaHealthInputs } from "@/lib/engine/mapaInputs";
import { computeChange, dqSignature, similarityMargin, storedRows } from "@/lib/engine/mapaEvolution";
import { computeRecommendation, isSuppressed } from "@/lib/engine/mapaRecommendation";

const ASOF = "2026-10-16";
const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"];
const month = (ym: string, income: number, spend: Array<[string | null, number]>): MapaMonthlyEntry[] => [
  { date: `${ym}-05`, kind: "income", amount: income },
  ...spend.map(([cat, amount], i): MapaMonthlyEntry => ({ date: `${ym}-${String(10 + i).padStart(2, "0")}`, kind: "expense", amount, category_id: cat })),
];
const steady = (income = 8000, spend: Array<[string | null, number]> = [["c-moradia", 3000], ["c-lazer", 1000]]) => MONTHS.flatMap((m) => month(m, income, spend));
const debt = (over: Partial<MapaDebtIn> = {}): MapaDebtIn => ({ id: "d1", name: "Empréstimo", status: "active", kind: "emprestimo_pessoal", outstanding_balance: 10000, installment_amount: 500, interest_rate_pct: 2, interest_rate_period: "mes", ...over });
const run = (entries: MapaMonthlyEntry[], extra: Partial<Parameters<typeof buildMapaReading>[0]> = {}): MapaReading => buildMapaReading({ asOf: ASOF, entries, nowIso: "2026-10-16T15:00:00Z", ...extra });
const ind = (r: MapaReading, id: string) => r.indicators.find((x) => x.id === id)!;
const health = (h: Partial<MapaHealthInputs>) => h;

const stored = (over: Partial<MapaStoredReading> & Pick<MapaStoredReading, "indicator_id">): MapaStoredReading => ({
  as_of: "2026-10-02", value: 10, formula_version: "x", window_end: null, window_kind: "pontual", window_n: 1, dq_signature: null, ...over,
});
const fake = (over: Partial<MapaIndicator> = {}): MapaIndicator => ({
  id: "seguranca.meses_cobertos", pillar: "seguranca", layer: "saude", value: 2, unit: "meses", direction: "higher_better", status: "atencao", confidence: "alta",
  window: { start: ASOF, end: ASOF, kind: "pontual", n: 1 }, evidence: ["balance"], inputs: {}, reasons: [], formula_version: "x", ...over,
});

describe("Evolução (E10)", () => {
  it("aplica o sentido favorável: mais reserva melhora; menos dívida melhora; mais dívida piora", () => {
    expect(computeChange(fake({ value: 3 }), [stored({ indicator_id: "seguranca.meses_cobertos", value: 2 })], ASOF, "s")?.direction).toBe("melhorou");
    const debtDown = fake({ id: "dividas.comprometimento_renda", unit: "pct", direction: "lower_better", value: 20 });
    expect(computeChange(debtDown, [stored({ indicator_id: debtDown.id, value: 30 })], ASOF, "s")).toMatchObject({ direction: "melhorou", delta: -10, comparable: true });
    expect(computeChange(fake({ ...debtDown, value: 40 }), [stored({ indicator_id: debtDown.id, value: 30 })], ASOF, "s")?.direction).toBe("piorou");
  });

  it("dentro da margem é 'parecido' (ruído não vira melhora/piora)", () => {
    const pct = fake({ id: "equilibrio.taxa_poupanca_3m", unit: "pct", value: 11 });
    expect(computeChange(pct, [stored({ indicator_id: pct.id, value: 10 })], ASOF, "s")?.direction).toBe("parecido");
    expect(similarityMargin("meses", 4)).toBeCloseTo(0.25);
    expect(similarityMargin("brl", 10000)).toBe(500);
  });

  it("indicador neutro nunca ganha 'melhorou/piorou'", () => {
    const n = fake({ id: "planejamento.intencionalidade", pillar: "planejamento", direction: "neutral", unit: "pct", value: 90 });
    expect(computeChange(n, [stored({ indicator_id: n.id, value: 10 })], ASOF, "s")).toMatchObject({ direction: "parecido", comparable: true });
  });

  it("fórmula mudou, janela diferente ou completude dos dados mudou = não comparável, com o motivo", () => {
    const cur = fake({ value: 3 });
    expect(computeChange(cur, [stored({ indicator_id: cur.id, formula_version: "antiga" })], ASOF, "s")).toMatchObject({ comparable: false, not_comparable_reason: "formula_changed", direction: "indefinido" });
    expect(computeChange(cur, [stored({ indicator_id: cur.id, formula_version: "x", window_kind: "meses_fechados", window_end: "2026-08-31", window_n: 3 })], ASOF, "s")).toMatchObject({ not_comparable_reason: "window_mismatch" });
    expect(computeChange(cur, [stored({ indicator_id: cur.id, formula_version: "x", dq_signature: "3|0|" })], ASOF, "4|0|")).toMatchObject({ not_comparable_reason: "data_completeness_changed" });
  });

  it("leitura pontual só se compara com outra de pelo menos 6 dias antes; nunca com ela mesma ou do futuro", () => {
    const cur = fake({ value: 3 });
    expect(computeChange(cur, [stored({ indicator_id: cur.id, as_of: "2026-10-12" })], ASOF, "s")).toBeNull();
    expect(computeChange(cur, [stored({ indicator_id: cur.id, as_of: ASOF })], ASOF, "s")).toBeNull();
    expect(computeChange(cur, [stored({ indicator_id: cur.id, as_of: "2026-10-20" })], ASOF, "s")).toBeNull();
    expect(computeChange(cur, [stored({ indicator_id: cur.id, as_of: "2026-10-09" })], ASOF, "s")).not.toBeNull();
  });

  it("janela de meses fechados: só compara com um período ANTERIOR (a mesma janela dá nada)", () => {
    const closed = fake({ id: "equilibrio.resultado_3m", pillar: "equilibrio", unit: "brl", value: 6000, window: { start: "2026-07-01", end: "2026-09-30", kind: "meses_fechados", n: 3 } });
    const same = stored({ indicator_id: closed.id, as_of: "2026-10-10", window_kind: "meses_fechados", window_end: "2026-09-30", window_n: 3 });
    expect(computeChange(closed, [same], ASOF, "s")).toBeNull();
    const older = stored({ indicator_id: closed.id, as_of: "2026-09-20", value: 4000, formula_version: "x", window_kind: "meses_fechados", window_end: "2026-08-31", window_n: 3 });
    expect(computeChange(closed, [older], ASOF, "s")).toMatchObject({ previous: 4000, delta: 2000, direction: "melhorou" });
  });

  it("valor nulo de um lado: indefinido, sem inventar delta", () => {
    const cur = fake({ value: null, status: "sem_dados", confidence: "insuficiente" });
    expect(computeChange(cur, [stored({ indicator_id: cur.id })], ASOF, "s")).toMatchObject({ comparable: false, delta: null });
  });

  it("na leitura completa, as linhas gravadas voltam como histórico e geram change válido (contrato)", () => {
    const first = run(steady(), { health: health({ categoryEssential: { "c-moradia": true, "c-lazer": false } }) });
    const rows = storedRows(first);
    expect(rows.length).toBe(first.indicators.length);
    const history = rows.map((r) => ({ ...r, as_of: "2026-10-02" }));
    const second = run(steady(9000), { health: health({ categoryEssential: { "c-moradia": true, "c-lazer": false } }), history });
    expect(validateMapaReading(second)).toEqual([]);
    expect(second.indicators.some((i) => i.change?.comparable)).toBe(true);
    expect(dqSignature(second)).toBe(dqSignature(first));
  });
});

describe("Recomendação (E11)", () => {
  const fb = (rec_id: string, event: MapaRecommendationFeedback["event"], at: string): MapaRecommendationFeedback => ({ rec_id, event, at });

  it("G8 — essenciais acima de 80% da renda: recomendação ESTRUTURAL, nunca dica de comportamento", () => {
    const r = run(steady(8000, [["c-moradia", 6800], ["c-lazer", 200]]), { health: health({ categoryEssential: { "c-moradia": true, "c-lazer": false } }) });
    expect(r.structural.structural).toBe(true);
    expect(r.recommendation).toMatchObject({ kind: "estrutural", action: { type: "revisar_essenciais", deeplink: "/app/recorrencias" } });
    expect(r.recommendation!.guardrails).toContain("nao_sugerir_corte_de_pequenos_gastos");
  });

  it("dívida pesando mais de 50% da renda: estrutural → renegociar, e vence o resto", () => {
    const r = run(steady(8000), { health: health({ debts: [debt({ installment_amount: 4500 })], categoryEssential: { "c-moradia": true, "c-lazer": false } }) });
    expect(r.recommendation).toMatchObject({ kind: "estrutural", action: { type: "renegociar_dividas", deeplink: "/app/dividas" } });
  });

  it("3 meses seguidos no vermelho: estrutural → fechar a conta", () => {
    const r = run(MONTHS.flatMap((m) => month(m, 5000, [["c-a", 6000]])));
    expect(r.recommendation).toMatchObject({ kind: "estrutural", action: { type: "fechar_a_conta" } });
  });

  it("sem estrutura, mas atraso: regularizar atrasos tem prioridade sobre reserva baixa", () => {
    const h = health({
      categoryEssential: { "c-moradia": true, "c-lazer": false }, debts: [debt({ installment_amount: 200 })], debtOverdue: { count: 1, amount: 800, max_days: 12 },
      snapshot: { availableToday: 300, confirmedFutureInflows: 0, estimatedFixedInflows: 0, knownFutureCommitments: 0, cardDueThisMonth: 0, netWorthNet: 0, bridge: null },
    });
    const r = run(steady(8000), { health: h });
    expect(r.structural.structural).toBe(false);
    expect(r.recommendation).toMatchObject({ kind: "comportamento", action: { type: "regularizar_atrasos" } });
  });

  it("reserva baixa sem atraso: criar reserva, com a evidência apontando o indicador", () => {
    const h = health({
      categoryEssential: { "c-moradia": true, "c-lazer": false },
      snapshot: { availableToday: 500, confirmedFutureInflows: 0, estimatedFixedInflows: 0, knownFutureCommitments: 0, cardDueThisMonth: 0, netWorthNet: 0, bridge: null },
    });
    const r = run(steady(8000), { health: h });
    expect(r.recommendation).toMatchObject({ kind: "comportamento", action: { type: "criar_reserva" }, indicator_ids: ["seguranca.meses_cobertos"] });
  });

  it("REGRESSÃO conta real: saindo mais do que entra, NÃO recomenda 'criar reserva' (prematuro) e sim entender o desequilíbrio", () => {
    // 3 meses: dois negativos e um positivo (não é a sequência estrutural), reserva baixíssima.
    const entries = [...month("2026-07", 8000, [["c-moradia", 3000], ["c-lazer", 11000]]), ...month("2026-08", 8500, [["c-moradia", 3000], ["c-lazer", 9500]]), ...month("2026-09", 24000, [["c-moradia", 3000], ["c-lazer", 13000]])];
    const h = health({
      categoryEssential: { "c-moradia": true, "c-lazer": false },
      snapshot: { availableToday: 1377, confirmedFutureInflows: 0, estimatedFixedInflows: 0, knownFutureCommitments: 0, cardDueThisMonth: 0, netWorthNet: -60000, bridge: null },
    });
    const r = run(entries, { health: h });
    expect(r.structural.structural).toBe(false);
    expect(ind(r, "seguranca.meses_cobertos").status).toBe("critico");
    expect(r.recommendation).toMatchObject({ kind: "comportamento", action: { type: "fechar_a_conta" }, guardrails: ["reserva_so_depois_de_fechar_a_conta"] });
    expect(r.recommendation!.indicator_ids).toContain("equilibrio.resultado_3m");
  });

  it("lazer alto com tudo mais em dia NÃO gera recomendação", () => {
    const h = health({
      categoryEssential: { "c-moradia": true, "c-lazer": false },
      snapshot: { availableToday: 40000, confirmedFutureInflows: 0, estimatedFixedInflows: 0, knownFutureCommitments: 0, cardDueThisMonth: 0, netWorthNet: 40000, bridge: null },
    });
    const r = run(steady(10000, [["c-moradia", 3000], ["c-lazer", 3000]]), { health: h });
    expect(r.recommendation).toBeNull();
  });

  it("supressão: recusada há 10 dias fica fora (30 dias); há 40 dias volta; aceita há 5 dias espera", () => {
    expect(isSuppressed("a", [fb("a", "dismissed", "2026-10-06T12:00:00Z")], ASOF)).toBe(true);
    expect(isSuppressed("a", [fb("a", "dismissed", "2026-09-06T12:00:00Z")], ASOF)).toBe(false);
    expect(isSuppressed("a", [fb("a", "accepted", "2026-10-11T12:00:00Z")], ASOF)).toBe(true);
    expect(isSuppressed("a", [fb("b", "dismissed", "2026-10-15T12:00:00Z")], ASOF)).toBe(false);
    expect(isSuppressed("a", [fb("a", "shown", "2026-10-15T12:00:00Z")], ASOF)).toBe(false);
  });

  it("recusar a estrutural não a troca por dica de comportamento: simplesmente não recomenda", () => {
    const h = health({ categoryEssential: { "c-moradia": true, "c-lazer": false } });
    const entries = steady(8000, [["c-moradia", 6800], ["c-lazer", 200]]);
    const r = run(entries, { health: h, feedback: [fb("estrutural:revisar_essenciais", "dismissed", "2026-10-10T12:00:00Z")] });
    expect(r.structural.structural).toBe(true);
    expect(r.recommendation).toBeNull();
  });

  it("uma só recomendação, e a leitura continua válida pelo contrato", () => {
    const r = run(steady(), { health: health({ categoryEssential: { "c-moradia": true, "c-lazer": false } }) });
    expect(validateMapaReading(r)).toEqual([]);
    expect(Array.isArray(r.recommendation)).toBe(false);
  });

  it("computeRecommendation com dado insuficiente não recomenda nada", () => {
    expect(computeRecommendation({ asOf: ASOF, indicators: [], structural: { essential_share_of_income: null, debt_service_ratio: null, negative_result_streak: null, structural: null }, dq: {} as never, feedback: [] })).toBeNull();
  });
});
