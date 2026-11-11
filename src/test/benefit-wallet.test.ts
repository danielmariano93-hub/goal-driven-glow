import { describe, expect, it } from "vitest";
import {
  benefitAddDays, balanceSeries, computeBalance, computeBenefitState, computeRate, creditDateInMonth, cycleBounds,
  merchantBreakdown, suggestions, weekdayPattern, whatIf, type BenefitEntry, type BenefitWalletConfig,
} from "@/lib/engine/benefitWallet";

const wallet: BenefitWalletConfig = { monthly_credit: 900, credit_day: 5, carries_over: true };
let seq = 0;
const e = (kind: BenefitEntry["kind"], amount: number, occurred_on: string, merchant?: string): BenefitEntry => ({ id: `e${++seq}`, kind, amount, occurred_on, merchant });

// Ciclo de 05/11 a 05/12, hoje 18/11. Sobra do ciclo anterior R$ 12, crédito R$ 900 (previsto, não lançado), gastos R$ 499,60.
const TODAY = "2026-11-18";
const cycle: BenefitEntry[] = [
  e("balance_reading", 12, "2026-11-04"),
  e("spend", 80, "2026-11-05", "Mercado Extra"), e("spend", 45, "2026-11-06", "Restaurante Sabor & Cia"),
  e("spend", 52.8, "2026-11-07", "iFood"), e("spend", 70.3, "2026-11-09", "Mercado Extra"),
  e("spend", 39, "2026-11-10", "Padaria"), e("spend", 21, "2026-11-12"),
  e("spend", 83.5, "2026-11-13", "Restaurante Sabor & Cia"), e("spend", 64, "2026-11-14", "Mercado Extra"),
  e("spend", 44, "2026-11-15", "iFood"),
];

describe("Ticket Alimentação — ciclo e saldo", () => {
  it("o ciclo vai do último crédito ao próximo", () => {
    expect(cycleBounds(5, TODAY)).toEqual({ start: "2026-11-05", next: "2026-12-05", total_days: 30, elapsed_days: 13, days_left: 17 });
    // antes do crédito do mês, o ciclo é o do mês anterior
    expect(cycleBounds(5, "2026-11-03")).toMatchObject({ start: "2026-10-05", next: "2026-11-05", days_left: 2 });
    // virada de ano
    expect(cycleBounds(5, "2026-12-20")).toMatchObject({ start: "2026-12-05", next: "2027-01-05" });
  });

  it("crédito no dia 31 cai no último dia dos meses curtos", () => {
    expect(creditDateInMonth(2026, 10, 31)).toBe("2026-11-30");
    expect(creditDateInMonth(2027, 1, 31)).toBe("2027-02-28");
    expect(cycleBounds(31, "2026-11-29")).toMatchObject({ start: "2026-10-31", next: "2026-11-30" });
    expect(cycleBounds(31, "2026-11-30")).toMatchObject({ start: "2026-11-30", next: "2026-12-31" });
  });

  it("saldo = leitura + crédito previsto − gastos (o crédito não precisa ser lançado)", () => {
    const spent = cycle.filter((x) => x.kind === "spend").reduce((s, x) => s + x.amount, 0);
    expect(Math.round(spent * 100) / 100).toBe(499.6);
    const r = computeBalance(wallet, cycle, TODAY);
    expect(r.balance).toBe(412.4);
    expect(r.anchor).toEqual({ date: "2026-11-04", amount: 12 });
    expect(r.reading_age_days).toBe(14);
    expect(r.inconsistent).toBe(false);
  });

  it("crédito já lançado não conta duas vezes", () => {
    const withCredit = [...cycle, e("credit", 900, "2026-11-05")];
    expect(computeBalance(wallet, withCredit, TODAY).balance).toBe(computeBalance(wallet, cycle, TODAY).balance);
  });

  it("sobra acumula ou é perdida conforme a carteira", () => {
    const only = [e("balance_reading", 120, "2026-11-04")];
    expect(computeBalance({ ...wallet, carries_over: true }, only, "2026-11-06").balance).toBe(1020);
    expect(computeBalance({ ...wallet, carries_over: false }, only, "2026-11-06").balance).toBe(900);
  });

  it("sem leitura não há saldo, projeção nem semáforo", () => {
    const s = computeBenefitState(wallet, [], TODAY);
    expect(s.balance).toBeNull();
    expect(s.needs_reading).toBe(true);
    expect(s.projection).toBeNull();
    expect(whatIf(s, 30)).toBeNull();
  });

  it("saldo negativo (faltam lançamentos) vira zero e é sinalizado", () => {
    const r = computeBalance(wallet, [e("balance_reading", 10, "2026-11-10"), e("spend", 50, "2026-11-11")], "2026-11-12");
    expect(r.balance).toBe(0);
    expect(r.inconsistent).toBe(true);
  });
});

describe("Ticket Alimentação — ritmo, projeção e simulação", () => {
  it("ritmo = gastos dos últimos 14 dias ÷ 14", () => {
    const rate = computeRate(wallet, cycle, TODAY);
    expect(rate).toEqual({ per_day: 35.69, source: "spends", days_observed: 14 });
  });

  it("o ciclo completo fecha: saldo, ideal, cobertura, esgotamento e falta", () => {
    const s = computeBenefitState(wallet, cycle, TODAY);
    expect(s.cycle).toEqual({ start: "2026-11-05", next: "2026-12-05", total_days: 30, elapsed_days: 13, days_left: 17 });
    expect(s.balance).toBe(412.4);
    expect(s.estimated).toBe(true);
    expect(s.carry_in).toBe(12);
    expect(s.spent_in_cycle).toBe(499.6);
    expect(s.ideal_per_day).toBe(24.26);
    expect(s.projection).toEqual({
      covers_days: 11.56, depletion_date: "2026-11-30", uncovered_days: 5.44, shortfall: 194.33, leftover: 0, status: "short",
    });
  });

  it("E se eu gastar menos: R$ 24 por dia fecha o ciclo e sobra para o próximo", () => {
    const s = computeBenefitState(wallet, cycle, TODAY);
    expect(whatIf(s, 24)).toMatchObject({ depletion_date: null, uncovered_days: 0, shortfall: 0, leftover: 4.4, status: "ok" });
    expect(whatIf(s, 30)).toMatchObject({ depletion_date: "2026-12-02", status: "short", shortfall: 97.6 });
    expect(whatIf(s, 80)?.status).toBe("short");
  });

  it("sem gastos lançados, o ritmo vem da diferença entre duas leituras", () => {
    const rate = computeRate(wallet, [e("balance_reading", 912, "2026-11-05"), e("balance_reading", 700, "2026-11-12")], "2026-11-12");
    expect(rate).toEqual({ per_day: 30.29, source: "readings", days_observed: 7 });
  });

  it("série diária do ciclo termina no saldo de hoje", () => {
    const series = balanceSeries(wallet, cycle, TODAY);
    expect(series).toHaveLength(14);
    expect(series[0].date).toBe("2026-11-05");
    expect(series[series.length - 1]).toEqual({ date: TODAY, balance: 412.4 });
  });
});

describe("Ticket Alimentação — padrões e sugestões", () => {
  // 8 semanas (24/09 a 18/11): seg 20, ter 30, qua 20, qui 20, sex 80, sáb 50, dom 20 → R$ 240 por semana.
  const perDay: Record<number, number> = { 1: 20, 2: 30, 3: 20, 4: 20, 5: 80, 6: 50, 0: 20 };
  const weeks: BenefitEntry[] = [];
  for (let d = "2026-09-24"; d <= TODAY; d = benefitAddDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    weeks.push(e("spend", perDay[wd], d, wd === 5 ? "iFood" : "Mercado Extra"));
  }

  it("a sexta pesa 33% e custa 3x a média dos outros dias", () => {
    const p = weekdayPattern(weeks, TODAY);
    expect(p.total).toBe(1920);
    expect(p.peak).toMatchObject({ label: "sex", share_pct: 33, avg_per_occurrence: 80, others_avg: 26.67, ratio: 3 });
    expect(p.by_weekday.map((d) => d.label)).toEqual(["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]);
  });

  it("poucos dados não inventam padrão", () => {
    expect(weekdayPattern([e("spend", 50, "2026-11-17"), e("spend", 40, "2026-11-18")], TODAY).peak).toBeNull();
    expect(weekdayPattern([e("balance_reading", 500, "2026-11-01")], TODAY).peak).toBeNull();
  });

  it("estabelecimentos agrupam sem diferenciar maiúsculas e o excedente vira Outros", () => {
    const rows = merchantBreakdown([
      e("spend", 10, "2026-11-06", "iFood"), e("spend", 15, "2026-11-07", " IFOOD "), e("spend", 100, "2026-11-08", "Mercado"),
      e("spend", 5, "2026-11-09", "Padaria"), e("spend", 3, "2026-11-10", "Banca"),
    ], "2026-11-05", TODAY, 2);
    expect(rows.map((r) => [r.merchant, r.total])).toEqual([["Mercado", 100], ["iFood", 25], ["Outros", 8]]);
    expect(rows.reduce((s, r) => s + r.share_pct, 0)).toBeGreaterThanOrEqual(99);
  });

  it("sugestões saem dos dados: teto da sexta, metade do delivery e teto diário", () => {
    const entries = [e("balance_reading", 12, "2026-09-23"), ...weeks];
    const s = computeBenefitState({ ...wallet, monthly_credit: 900 }, entries, TODAY);
    const sug = suggestions(s, weekdayPattern(entries, TODAY), merchantBreakdown(entries, s.cycle.start, TODAY));
    const ids = sug.map((x) => x.id);
    expect(ids).toContain("weekday_cap");
    expect(ids).toContain("half_delivery");
    const cap = sug.find((x) => x.id === "weekday_cap");
    expect(cap?.title).toBe("Teto de R$ 45 às sextas");
    expect(cap?.monthly_saving).toBe(150);
  });
});

describe("Ticket Alimentação — padrão desde os primeiros dias", () => {
  // 7 dias (27/10 a 02/11): um gasto por dia, a quinta (29/10) concentra mais.
  const week: BenefitEntry[] = [
    e("spend", 20, "2026-10-27"), e("spend", 20, "2026-10-28"), e("spend", 60, "2026-10-29"),
    e("spend", 20, "2026-10-30"), e("spend", 20, "2026-10-31"), e("spend", 20, "2026-11-01"), e("spend", 20, "2026-11-02"),
  ];

  it("com 7 dias já aponta o dia que mais pesa, com confiança baixa e média pelas ocorrências reais", () => {
    const p = weekdayPattern(week, "2026-11-03");
    expect(p.days_observed).toBe(7);
    expect(p.confidence).toBe("low");
    expect(p.peak).toMatchObject({ label: "qui", share_pct: 33, avg_per_occurrence: 60, others_avg: 20, ratio: 3 });
  });

  it("menos de 3 gastos ou 5 dias não inventa padrão", () => {
    expect(weekdayPattern(week.slice(0, 2), "2026-11-03").peak).toBeNull();
    expect(weekdayPattern([e("spend", 20, "2026-11-01"), e("spend", 20, "2026-11-02"), e("spend", 20, "2026-11-02")], "2026-11-03").peak).toBeNull();
  });

  it("a confiança sobe com o histórico", () => {
    expect(weekdayPattern(week, "2026-11-03").confidence).toBe("low");
    expect(weekdayPattern([e("spend", 20, "2026-10-14"), ...week], "2026-11-03").confidence).toBe("medium");
    expect(weekdayPattern([e("spend", 20, "2026-10-01"), ...week], "2026-11-03").confidence).toBe("high");
  });

  it("dica de teto só com confiança média ou alta (conselho com 1 ocorrência seria chute)", () => {
    const base = [e("balance_reading", 500, "2026-10-26"), ...week];
    const s = computeBenefitState({ ...wallet, credit_day: 27 }, base, "2026-11-03");
    const ids = suggestions(s, weekdayPattern(base, "2026-11-03"), merchantBreakdown(base, s.cycle.start, "2026-11-03")).map((x) => x.id);
    expect(ids).not.toContain("weekday_cap");
  });
});

describe("Ticket Alimentação — gastar durante o dia não bagunça ritmo e ideal", () => {
  // Ciclo de 27/10 a 27/11, hoje 09/11 (18 dias contando hoje). Saldo de abertura R$ 17,45 + crédito R$ 1.227,16 − gastos R$ 569,36 = R$ 675,25.
  const w: BenefitWalletConfig = { monthly_credit: 1227.16, credit_day: 27, carries_over: true };
  const T = "2026-11-09";
  const base: BenefitEntry[] = [e("balance_reading", 17.45, "2026-10-26")];
  const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
  days.forEach((d, i) => base.push(e("spend", i === 12 ? 569.36 - 12 * 43.8 : 43.8, d)));

  it("de manhã (nada gasto hoje): ideal = saldo ÷ dias que faltam, ritmo só com dias fechados", () => {
    const s = computeBenefitState(w, base, T);
    expect(s.balance).toBe(675.25);
    expect(s.cycle.days_left).toBe(18);
    expect(s.spent_today).toBe(0);
    expect(s.day_start_balance).toBe(675.25);
    expect(s.ideal_per_day).toBe(37.51);
    expect(s.today_remaining).toBe(37.51);
    expect(s.rate.per_day).toBe(40.67);
  });

  it("gastar R$ 26 hoje não muda ideal, ritmo, cobertura nem o que falta: só mostra quanto ainda cabe hoje", () => {
    const before = computeBenefitState(w, base, T);
    const after = computeBenefitState(w, [...base, e("spend", 26, T)], T);
    expect(after.balance).toBe(649.25);
    expect(after.day_start_balance).toBe(675.25);
    expect(after.ideal_per_day).toBe(before.ideal_per_day);
    expect(after.rate).toEqual(before.rate);
    expect(after.projection).toEqual(before.projection);
    expect(after.spent_today).toBe(26);
    expect(after.today_remaining).toBe(11.51);
    expect(whatIf(after, 37.51)).toEqual(whatIf(before, 37.51));
  });

  it("gastar mais que o ideal hoje zera o que cabe hoje (nunca negativo)", () => {
    const s = computeBenefitState(w, [...base, e("spend", 50, T)], T);
    expect(s.today_remaining).toBe(0);
    expect(s.ideal_per_day).toBe(37.51);
  });

  it("estourar o ideal de hoje mostra quanto passou, em %, e quanto dá por dia daqui para frente", () => {
    const s = computeBenefitState(w, [...base, e("spend", 50, T)], T);
    expect(s.today_over).toBe(12.49);
    expect(s.today_over_pct).toBe(33);
    expect(s.ideal_from_tomorrow).toBe(Math.round((s.balance! / (s.cycle.days_left - 1)) * 100) / 100);
    expect(s.ideal_from_tomorrow!).toBeLessThan(s.ideal_per_day!);
  });

  it("sem estouro, o estouro é zero", () => {
    const s = computeBenefitState(w, [...base, e("spend", 26, T)], T);
    expect(s.today_over).toBe(0);
    expect(s.today_over_pct).toBe(0);
  });

  it("no dia seguinte o ideal sobe, porque o que sobrou hoje se espalha pelos dias restantes", () => {
    const tomorrow = computeBenefitState(w, [...base, e("spend", 26, T)], "2026-11-10");
    expect(tomorrow.cycle.days_left).toBe(17);
    expect(tomorrow.ideal_per_day).toBe(38.19);
  });

  it("o ritmo ignora o gasto parcial de hoje (só dias fechados)", () => {
    const withToday = computeRate(w, [...base, e("spend", 300, T)], T);
    expect(withToday).toEqual(computeRate(w, base, T));
  });
});
