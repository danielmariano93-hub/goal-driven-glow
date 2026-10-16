import { describe, it, expect } from "vitest";
import { buildMapaReading } from "@/lib/engine/mapaReading";
import { validateMapaReading, type MapaReading } from "@/lib/engine/mapaContracts";
import type { MapaMonthlyEntry } from "@/lib/engine/mapaMonthly";
import type { MapaDebtIn, MapaHealthInputs, MapaSnapshotInput } from "@/lib/engine/mapaInputs";
import { explainRedemptions } from "@/lib/engine/mapaFuturo";
import { annualToMonthlyPct } from "@/lib/engine/mapaDividas";
import { olsSlope } from "@/lib/engine/mapaEquilibrio";
import { snapshotInputFromPayload } from "@/lib/engine/mapaInputs";

const ASOF = "2026-10-16";
const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"];
/** Mês fechado: uma renda e despesas em categorias dadas. */
const month = (ym: string, income: number, spend: Array<[string | null, number]>): MapaMonthlyEntry[] => [
  { date: `${ym}-05`, kind: "income", amount: income },
  ...spend.map(([cat, amount], i): MapaMonthlyEntry => ({ date: `${ym}-${String(10 + i).padStart(2, "0")}`, kind: "expense", amount, category_id: cat })),
];
const steady = (income = 8000, spend = 6000) => MONTHS.flatMap((m) => month(m, income, [["c-mercado", spend * 0.5], ["c-lazer", spend * 0.5]]));
const snap = (over: Partial<MapaSnapshotInput> = {}): MapaSnapshotInput => ({
  availableToday: 1437.69, confirmedFutureInflows: 0, estimatedFixedInflows: 7800, knownFutureCommitments: 1919.86, cardDueThisMonth: 3222.39, netWorthNet: -60854.65,
  bridge: { openingDebts: 72424.73, closingDebts: 66321.63, netWorthChange: -2868.04, operationalResult: -1341, investmentReturn: 0.04, investmentApplications: 0, investmentRedemptions: 7000, debtPrincipalChange: -6103.1, valuationAdjustments: 0, confidence: "low" },
  ...over,
});
const run = (entries: MapaMonthlyEntry[], health: Partial<MapaHealthInputs> = {}): MapaReading => buildMapaReading({ asOf: ASOF, entries, health });
const ind = (r: MapaReading, id: string) => r.indicators.find((x) => x.id === id)!;
const debt = (over: Partial<MapaDebtIn> = {}): MapaDebtIn => ({ id: "d1", name: "Cartão", status: "active", kind: null, outstanding_balance: 10000, installment_amount: 500, interest_rate_pct: null, interest_rate_period: null, ...over });

describe("Equilíbrio (E2)", () => {
  it("3 meses fechados com sobra: resultado e taxa de poupança, só meses fechados", () => {
    const r = run([...steady(8000, 6000), { date: "2026-10-14", kind: "income", amount: 208.67 }]);
    expect(ind(r, "equilibrio.resultado_3m")).toMatchObject({ value: 6000, status: "ok" });
    expect(ind(r, "equilibrio.taxa_poupanca_3m")).toMatchObject({ value: 25, status: "ok" });
    expect(ind(r, "equilibrio.taxa_poupanca_3m").inputs.renda_3m).toBe(24000); // outubro parcial fora (G2)
  });

  it("gastar mais que ganha nos 3 meses é crítico", () => {
    const r = run(MONTHS.flatMap((m) => month(m, 5000, [["c-a", 6000]])));
    expect(ind(r, "equilibrio.resultado_3m").status).toBe("critico");
    expect(ind(r, "equilibrio.taxa_poupanca_3m")).toMatchObject({ value: -20, status: "critico" });
  });

  it("G9 — com 1 mês fechado, razões e tendência ficam sem dados e dizem o que falta", () => {
    const r = run(month("2026-09", 5000, [["c-a", 3000]]));
    for (const id of ["equilibrio.resultado_3m", "equilibrio.taxa_poupanca_3m", "equilibrio.tendencia"]) {
      expect(ind(r, id).status).toBe("sem_dados");
      expect(ind(r, id).needs?.kind).toBe("history");
    }
  });

  it("cobertura do mês: dinheiro certo × com estimativa de renda são indicadores separados", () => {
    const r = run(steady(), { snapshot: snap() });
    const certo = ind(r, "equilibrio.cobertura_mes"), est = ind(r, "equilibrio.cobertura_mes_com_estimativa");
    expect(certo.value).toBeCloseTo(1437.69 / (1919.86 + 3222.39), 2);
    expect(certo.status).toBe("critico");
    // cobertura nunca passa de 100%: o que passa vira "folga" em reais
    expect(est.value).toBe(1);
    expect(est.status).toBe("ok");
    expect(est.inputs.folga).toBeCloseTo(1437.69 + 7800 - (1919.86 + 3222.39), 2);
    expect(est.evidence).toContain("estimate");
    expect(certo.evidence).not.toContain("estimate");
  });

  it("sem snapshot: cobertura sem dados pedindo conexão", () => {
    const c = ind(run(steady()), "equilibrio.cobertura_mes");
    expect(c).toMatchObject({ status: "sem_dados", needs: { kind: "connect" } });
  });

  it("tendência com 4 meses: piora clara vira atenção", () => {
    const declining = MONTHS.flatMap((m, i) => month(m, 8000, [["c-a", 4000 + i * 1500]]));
    expect(ind(run(declining), "equilibrio.tendencia")).toMatchObject({ status: "atencao" });
    expect(olsSlope([1, 2, 3, 4])).toBeCloseTo(1, 6);
    expect(olsSlope([5])).toBeNull();
  });
});

describe("Segurança (E3)", () => {
  it("G1 — R$ 1.437 de caixa contra gasto típico de ~R$ 18 mil = ~0,08 mês, nunca 0,9; sem flag de essencial rotula 'gastos totais'", () => {
    const entries = MONTHS.flatMap((m, i) => month(m, 16000, [["c-a", [22490.61, 15303.48, 15859.45, 17884][i]]]));
    const r = run(entries, { snapshot: snap() });
    const s = ind(r, "seguranca.meses_cobertos");
    expect(s.value).toBeLessThan(0.15);
    expect(s.status).toBe("critico");
    expect(s.inputs.base).toBe("gastos_totais");
    expect(s.reasons).toContain("essential_flag_missing");
    expect(s.needs).toEqual({ kind: "capture", code: "essencial_categoria" });
  });

  it("com ≥ 80% do consumo classificado usa só os essenciais", () => {
    const entries = MONTHS.flatMap((m) => month(m, 8000, [["c-moradia", 3000], ["c-mercado", 1500], ["c-lazer", 1500]]));
    const flags = { "c-moradia": true, "c-mercado": true, "c-lazer": false };
    const s = ind(run(entries, { snapshot: snap({ availableToday: 13500 }), categoryEssential: flags }), "seguranca.meses_cobertos");
    expect(s.inputs.base).toBe("essenciais");
    expect(s.inputs.gasto_mensal_tipico).toBe(4500);
    expect(s.value).toBe(3);
    expect(s.reasons).not.toContain("essential_flag_missing");
  });

  it("parcelas de dívida entram no gasto mensal (ficam fora do consumo no ledger)", () => {
    const entries = MONTHS.flatMap((m) => month(m, 8000, [["c-a", 2000]]));
    const s = ind(run(entries, { snapshot: snap({ availableToday: 6000 }), debts: [debt({ installment_amount: 1000 })] }), "seguranca.meses_cobertos");
    expect(s.inputs.gasto_mensal_tipico).toBe(3000);
    expect(s.value).toBe(2);
  });

  it("a meta de meses depende da estabilidade da renda (irregular exige mais)", () => {
    const regular = ind(run(steady(), { snapshot: snap({ availableToday: 10000 }) }), "seguranca.meses_cobertos");
    expect(regular.inputs.meta_meses).toBe(3);
    const irr = MONTHS.flatMap((m, i) => month(m, [34000, 7700, 8500, 24000][i], [["c-a", 6000]]));
    expect(ind(run(irr, { snapshot: snap({ availableToday: 10000 }) }), "seguranca.meses_cobertos").inputs.meta_meses).toBe(6);
  });

  it("investimento só conta como liquidez se a liquidez for conhecida e curta", () => {
    const entries = MONTHS.flatMap((m) => month(m, 8000, [["c-a", 2000]]));
    const inv = [
      { id: "i1", name: "CDB D+1", current_value: 5000, liquidity: "d1" as const, reserve_role: null },
      { id: "i2", name: "Fundo", current_value: 9000, liquidity: null, reserve_role: null },
      { id: "i3", name: "Previdência", current_value: 7000, liquidity: "longo" as const, reserve_role: null },
    ];
    const s = ind(run(entries, { snapshot: snap({ availableToday: 1000 }), investments: inv }), "seguranca.meses_cobertos");
    expect(s.inputs.investimentos_liquidos).toBe(5000);
    expect(s.reasons).toContain("liquidez_de_investimentos_desconhecida");
  });

  it("choque de 1 renda: liquidez ÷ renda típica", () => {
    const c = ind(run(steady(8000, 6000), { snapshot: snap({ availableToday: 4000 }) }), "seguranca.choque_1_renda");
    expect(c).toMatchObject({ value: 0.5, status: "atencao" });
  });

  it("sem snapshot ou sem histórico: sem dados", () => {
    expect(ind(run(steady()), "seguranca.meses_cobertos").needs?.kind).toBe("connect");
    expect(ind(run(month("2026-09", 5000, [["c-a", 3000]]), { snapshot: snap() }), "seguranca.meses_cobertos").needs?.kind).toBe("history");
  });
});

describe("Dívidas (E4)", () => {
  it("G5 — 6 dívidas sem taxa: custo médio sem dados, pedindo captura; tipo ausente também", () => {
    const debts = Array.from({ length: 6 }, (_, k) => debt({ id: `d${k}`, outstanding_balance: 11000 }));
    const r = run(steady(), { debts });
    expect(ind(r, "dividas.custo_medio")).toMatchObject({ status: "sem_dados", needs: { code: "debt_rate" } });
    expect(ind(r, "dividas.perfil_custo_alto")).toMatchObject({ status: "sem_dados", needs: { code: "debt_kind" } });
  });

  it("taxa anual é convertida para mensal e ponderada pelo saldo", () => {
    expect(annualToMonthlyPct(12.68)).toBeCloseTo(1, 1);
    const debts = [
      debt({ id: "a", outstanding_balance: 9000, interest_rate_pct: 2, interest_rate_period: "mes" }),
      debt({ id: "b", outstanding_balance: 1000, interest_rate_pct: 12.68, interest_rate_period: "ano" }),
    ];
    const c = ind(run(steady(), { debts }), "dividas.custo_medio");
    expect(c.value).toBeCloseTo(1.9, 1);
    expect(c.status).toBe("ok");
  });

  it("taxa sem período informado não conta (ambígua)", () => {
    const c = ind(run(steady(), { debts: [debt({ interest_rate_pct: 3, interest_rate_period: null })] }), "dividas.custo_medio");
    expect(c.status).toBe("sem_dados");
  });

  it("comprometimento da renda típica e perfil de custo alto", () => {
    const debts = [debt({ id: "a", kind: "cartao_rotativo", outstanding_balance: 6000, installment_amount: 2000 }), debt({ id: "b", kind: "financiamento", outstanding_balance: 4000, installment_amount: 1000 })];
    const r = run(steady(8000, 4000), { debts });
    expect(ind(r, "dividas.comprometimento_renda")).toMatchObject({ value: 37.5, status: "atencao" });
    expect(ind(r, "dividas.perfil_custo_alto")).toMatchObject({ value: 60, status: "critico" });
  });

  it("sem dívidas ativas: tudo ok com motivo, não 'sem dados' enganoso", () => {
    const r = run(steady());
    expect(ind(r, "dividas.comprometimento_renda")).toMatchObject({ value: 0, status: "ok" });
    expect(ind(r, "dividas.comprometimento_renda").reasons).toContain("sem_dividas_ativas");
  });

  it("atrasos vêm do motor debt_status", () => {
    const r = run(steady(), { debts: [debt()], debtOverdue: { count: 2, amount: 800, max_days: 12 }, snapshot: snap() });
    expect(ind(r, "dividas.atrasos")).toMatchObject({ value: 2, status: "critico" });
  });

  it("REGRESSÃO conta real: pagar a FATURA do cartão não é 'dívida diminuiu'. A ponte (saldo caiu 6.103) não vira indicador; só principal pago registrado", () => {
    const r = run(steady(), { debts: [debt()], snapshot: snap(), debtPrincipalPaid90: 2400 });
    expect(r.indicators.find((i) => i.id === "dividas.trajetoria")).toBeUndefined();
    const a = ind(r, "dividas.amortizacao_90d");
    expect(a).toMatchObject({ value: 2400, direction: "neutral", status: "ok" });
    expect(a.inputs).not.toHaveProperty("saldo_inicial");
    expect(ind(run(steady(), { debts: [debt()], snapshot: snap(), debtPrincipalPaid90: null }), "dividas.amortizacao_90d").status).toBe("sem_dados");
  });
});

describe("Construção de futuro (E5)", () => {
  it("G4 — resgates ligados a pagamento de dívida em até 7 dias; o resto fica sem destino, nunca 'destruição'", () => {
    const ex = explainRedemptions(
      [{ date: "2026-10-06", amount: 6000 }, { date: "2026-10-10", amount: 1000 }],
      [{ date: "2026-10-08", amount: 5000 }, { date: "2026-10-30", amount: 900 }],
    );
    expect(ex).toEqual({ total: 7000, explained_by_debt: 5000, unexplained: 2000 });
  });

  it("variação do mês: só explica o que a ponte explica e mostra o resto como 'sem explicação' (nunca atribui à dívida paga)", () => {
    const v = ind(run(steady(), { snapshot: snap() }), "futuro.variacao_mes");
    expect(v.value).toBe(-2868.04);
    expect(v.reasons).toContain("mes_parcial");
    expect(v.inputs).toMatchObject({ resultado_operacional: -1341, sem_explicacao: -1527.08 });
    expect(v.inputs).not.toHaveProperty("amortizacao_de_divida");
    expect(v.confidence).toBe("moderada");
  });

  it("REGRESSÃO conta real: resgates são fato neutro ('sem destino' acusava a fatura paga com o resgate)", () => {
    const r = run(steady(), { snapshot: { ...snap(), investedNow: 4029.29 }, redemptions90: [{ date: "2026-10-06", amount: 7000 }, { date: "2026-08-20", amount: 3602 }] });
    expect(r.indicators.find((i) => i.id === "futuro.resgates_sem_destino")).toBeUndefined();
    expect(ind(r, "futuro.resgates_90d")).toMatchObject({ value: 10602, direction: "neutral", status: "ok" });
    expect(ind(r, "futuro.resgates_90d").inputs).toMatchObject({ investido_hoje: 4029.29 });
  });

  it("resultado dos 3 meses e taxa de poupança concordam (mesmo fato, mesmo selo)", () => {
    // 2 de 3 meses negativos, soma negativa: antes o resultado dizia 'atenção' e a taxa 'precisa de cuidado'.
    const r = run([...month("2026-07", 8000, [["a", 14000]]), ...month("2026-08", 8000, [["a", 12000]]), ...month("2026-09", 14000, [["a", 12000]])]);
    expect(ind(r, "equilibrio.resultado_3m").status).toBe("critico");
    expect(ind(r, "equilibrio.taxa_poupanca_3m").status).toBe("critico");
  });

  it("patrimônio negativo é atenção; metas de poupança comparam com o ritmo esperado", () => {
    const goals = [{ id: "g", name: "Viagem", target_amount: 10000, saved_amount: 2000, created_at: "2026-01-01", target_date: "2026-12-31" }];
    const r = run(steady(), { snapshot: snap(), savingsGoals: goals });
    expect(ind(r, "futuro.patrimonio_liquido").status).toBe("atencao");
    const g = ind(r, "futuro.progresso_metas");
    expect(g.value).toBe(20);
    expect(g.status).toBe("atencao"); // 20% guardado, ~79% do prazo decorrido
    expect(ind(run(steady(), { snapshot: snap() }), "futuro.progresso_metas")).toMatchObject({ status: "sem_dados", needs: { code: "meta_de_poupanca" } });
  });
});

describe("Gate estrutural", () => {
  it("G8 — essenciais acima de 80% da renda típica = estrutural", () => {
    const entries = MONTHS.flatMap((m) => month(m, 5000, [["c-moradia", 3000], ["c-mercado", 1200]]));
    const r = run(entries, { categoryEssential: { "c-moradia": true, "c-mercado": true } });
    expect(r.structural.essential_share_of_income).toBeCloseTo(0.84, 2);
    expect(r.structural.structural).toBe(true);
  });

  it("três meses seguidos de resultado negativo também é estrutural", () => {
    const entries = MONTHS.flatMap((m) => month(m, 5000, [["c-a", 5600]]));
    expect(run(entries).structural).toMatchObject({ negative_result_streak: 3, structural: true });
  });

  it("sem essenciais confirmados, gasto total alto NÃO vira 'estrutural' (caso real: gasto total > renda típica)", () => {
    const entries = MONTHS.flatMap((m, i) => month(m, [34455.79, 7720.9, 8526.59, 24355.3][i], [["c-a", [36608.11, 22490.61, 15303.48, 15859.45][i]]]));
    const r = run(entries, { debts: [debt({ installment_amount: 1000 })] });
    expect(r.structural.essential_share_of_income).toBeNull();
    expect(r.structural.structural).toBe(false);
  });

  it("situação folgada não é estrutural; sem dados é indefinido", () => {
    expect(run(steady(8000, 3000)).structural.structural).toBe(false);
    expect(run([]).structural.structural).toBeNull();
  });
});

describe("contrato e conversão do snapshot", () => {
  it("a leitura completa respeita todas as invariantes do contrato", () => {
    const full = run(steady(), {
      snapshot: snap(), debts: [debt({ kind: "cartao_rotativo", interest_rate_pct: 12, interest_rate_period: "mes" })], debtOverdue: { count: 0, amount: 0, max_days: null },
      investments: [{ id: "i", name: "CDB", current_value: 4000, liquidity: "d1", reserve_role: null }],
      savingsGoals: [{ id: "g", name: "Meta", target_amount: 5000, saved_amount: 1000, created_at: "2026-06-01", target_date: "2027-06-01" }],
      redemptions90: [{ date: "2026-09-01", amount: 500 }], debtPayments90: [],
    });
    expect(full.indicators.length).toBeGreaterThanOrEqual(14);
    expect(validateMapaReading(full)).toEqual([]);
    expect(validateMapaReading(run([]))).toEqual([]);
    expect(validateMapaReading(run(month("2026-09", 5000, [["c-a", 3000]])))).toEqual([]);
  });

  it("nenhum indicador usa o mês em andamento como mês completo: janelas de razão são de meses fechados", () => {
    const r = run([...steady(), { date: "2026-10-14", kind: "income", amount: 99999 }], { snapshot: snap() });
    for (const id of ["equilibrio.resultado_3m", "equilibrio.taxa_poupanca_3m", "seguranca.meses_cobertos"]) {
      expect(ind(r, id).window.kind).toBe("meses_fechados");
      expect(ind(r, id).window.end < "2026-10-01").toBe(true);
    }
  });

  it("converte o payload do snapshot financeiro", () => {
    const s = snapshotInputFromPayload({ snapshot: { availableToday: 1437.69, netWorth: { net: -60854.65 }, projection: { confirmedFutureInflows: 0, estimatedFixedInflows: 7800, upcomingConfirmedCommitments: 1919.86, cardDueThisMonth: 3222.39 }, netWorthBridge: { openingDebts: 72424.73, closingDebts: 66321.63, netWorthChange: -2868.04, confidence: "low" } } });
    expect(s).toMatchObject({ availableToday: 1437.69, estimatedFixedInflows: 7800, knownFutureCommitments: 1919.86, cardDueThisMonth: 3222.39, netWorthNet: -60854.65 });
    expect(s?.bridge?.confidence).toBe("low");
    expect(snapshotInputFromPayload(null)).toBeNull();
  });
});
