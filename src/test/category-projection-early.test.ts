import { describe, expect, it } from "vitest";
import { evaluateCategoryGoal, type CategorySpendingGoalRow } from "@/lib/engine/metrics";
import { BLEND_WEIGHT_DAYS } from "@/lib/engine/categoryProjection";

// `category_projection.v2`: ritmo = mistura do ritmo do mês (sem o maior dia) com o histórico, peso do mês = dias/(dias+14);
// faixa = erro típico medido em backtest. Caso real (4/11): Lazer com R$ 368 num único dia (R$ 108 + 2 Pix de R$ 130),
// teto R$ 1.044,67 e histórico de R$ 1.414 / 2.028 / 1.445 — a v1 dizia "R$ 1.818,70, em risco".
const goal = (limit = 1044.67) => ({
  id: "g1", user_id: "u1", category_id: "lazer", mode: "percent_reduction", reduction_pct: 30, fixed_limit: null, baseline_kind: "avg_3m",
  baseline_value: 1492.39, computed_limit: limit, frequency: "monthly", start_date: "2026-11-01", end_date: "2026-11-30",
  status: "active", period_type: "this_month",
}) as CategorySpendingGoalRow;
let n = 0;
// Estabelecimentos distintos (só letras: o resolvedor tira dígitos e juntaria tudo numa "série" mensal).
const shop = (i: number) => `loja ${[...String(i)].map((d) => "abcdefghij"[Number(d)]).join("")}`;
const tx = (date: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id: `t${++n}`, user_id: "u1", account_id: "a", category_id: "lazer", type: "expense", status: "confirmed", amount, occurred_at: date,
  description: shop(n), merchant_name: shop(n), transfer_group_id: null, movement_kind: "transaction", payment_method: "account", ...extra,
}) as never;
const month = (ym: string, total: number) => [tx(`${ym}-05`, total / 2), tx(`${ym}-20`, total / 2)];
const history = [...month("2026-08", 1414), ...month("2026-09", 2028), ...month("2026-10", 1445)];
const histAvg = (1414 + 2028 + 1445) / 3;
const day1 = [tx("2026-11-01", 108), tx("2026-11-01", 130), tx("2026-11-01", 130)];
const ev = (txs: unknown[], today: string, g = goal()) => evaluateCategoryGoal(g, txs as never, new Date(`${today}T12:00:00`), "Lazer");

describe("projeção da meta por mistura (ritmo do mês + histórico)", () => {
  const e4 = ev([...history, ...day1], "2026-11-04");
  it("um único dia de gasto não vira 'ritmo': o ritmo do mês sai sem o maior dia", () => {
    expect(e4.projection.basis).toBe("blend");
    const w = 4 / (4 + BLEND_WEIGHT_DAYS);
    expect(e4.projection.paceWeight).toBeCloseTo(w, 2);
    // ritmo do mês sem o dia 1 = 0 → só o histórico pesa (1 − w)
    const expected = 368 + (1 - w) * (histAvg / 30) * 26;
    expect(e4.projectedFinalSpend).toBeCloseTo(expected, 0);
    expect(e4.projectedFinalSpend).toBeLessThan(1818.7); // a v1 dava R$ 1.818,70
  });
  it("mostra faixa (piso = gasto já feito) e o teto dentro dela vira 'Atenção', não 'Em risco'", () => {
    const r = e4.projection.range!;
    expect(r.low).toBeGreaterThanOrEqual(368);
    expect(r.low).toBeLessThan(e4.projectedFinalSpend);
    expect(r.high).toBeGreaterThan(e4.projectedFinalSpend);
    expect(r.low).toBeLessThanOrEqual(e4.targetAmount);
    expect(e4.status).toBe("attention");
    expect(e4.message).toMatch(/^Pode passar do teto: projeção R\$ [\d,]+, faixa de R\$ [\d,]+ a R\$ [\d,]+; o teto está dentro da faixa\. Base pequena: só 4 dias do mês\.$/);
  });
  it("só é 'Em risco' quando nem o cenário mais baixo cabe no teto", () => {
    const apertado = ev([...history, ...day1], "2026-11-04", goal(600));
    expect(apertado.projection.range!.low).toBeGreaterThan(600);
    expect(apertado.status).toBe("at_risk");
    expect(apertado.message).toMatch(/^Mesmo no cenário mais baixo \(R\$ [\d,]+\) você passa do teto\./);
  });
  it("dentro do teto: frase com a faixa e sem alarme", () => {
    const folga = ev([...history, ...day1], "2026-11-04", goal(5000));
    expect(folga.status).toBe("on_track");
    expect(folga.message).toMatch(/^Deve fechar perto de R\$ [\d,]+ \(faixa de R\$ [\d,]+ a R\$ [\d,]+\), dentro do teto\./);
  });
  it("com os dias, o ritmo do mês ganha peso e a base deixa de ser 'pequena'", () => {
    const daily = Array.from({ length: 20 }, (_, i) => tx(`2026-11-${String(1 + i).padStart(2, "0")}`, 50));
    const e20 = ev([...history, ...daily], "2026-11-20");
    expect(e20.projection.paceWeight).toBeCloseTo(20 / 34, 2);
    expect(e20.projection.confidence).toBe("medium");
    expect(e20.message).not.toMatch(/Base pequena/);
    // ritmo do mês (sem o maior dia) ≈ 49,5/dia; histórico ≈ 54,3/dia: o resultado fica entre os dois e perto do mês
    const rate = e20.projection.variableDailyRate;
    expect(rate).toBeGreaterThan(49);
    expect(rate).toBeLessThan(54.4);
  });
  it("sem histórico suficiente (menos de 2 meses fechados) não mistura: segue o método do período", () => {
    const e = ev([...month("2026-10", 1445), ...day1], "2026-11-04");
    expect(e.projection.basis).toBe("pace");
    expect(e.projection.range).toBeNull();
    expect(e.projection.paceWeight).toBeNull();
  });
  it("parcela antiga de cartão não entra na média histórica", () => {
    const carried = tx("2026-10-12", 900, { payment_method: "credit_card", credit_card_id: "cc1", installment_number: 2, installments_total: 3, purchase_group_id: "pg", purchase_date: "2026-08-12", competence_date: "2026-10-01" });
    const first = tx("2026-08-12", 900, { payment_method: "credit_card", credit_card_id: "cc1", installment_number: 1, installments_total: 3, purchase_group_id: "pg", purchase_date: "2026-08-12", competence_date: "2026-08-01" });
    const e = ev([...history, first, carried, ...day1], "2026-11-04");
    expect(e.projection.historicalMonthlyAvg).toBeCloseTo((1414 + 900 + 2028 + 1445) / 3, 0);
  });
  it("meta já estourada continua 'Ultrapassada' (a projeção não suaviza o que já passou do teto)", () => {
    const e = ev([...history, tx("2026-11-02", 1200)], "2026-11-04");
    expect(e.status).toBe("exceeded");
  });
});
