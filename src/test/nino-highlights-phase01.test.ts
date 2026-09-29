import { describe, expect, it } from "vitest";
import {
  brlPt,
  diagnosisCommunicationKind,
  normalizeMoneyText,
  presentSituation,
} from "../../supabase/functions/_shared/proactive/presentation";
import {
  applyDataQuality,
  assessDataQuality,
  incomeDataRequest,
} from "../../supabase/functions/_shared/proactive/dataQuality";
import { applyUserModel, buildUserModel } from "../../supabase/functions/_shared/proactive/userModel";
import { repeatedKind } from "../../supabase/functions/_shared/proactive/repetition";
import { allocateAttention, scoreSituations } from "../../supabase/functions/_shared/proactive/ranking";
import type {
  FinancialSituation,
  MultiFinanceProactiveContext,
} from "../../supabase/functions/_shared/proactive/contracts";
import { deterministicCandidates } from "../../supabase/functions/_shared/insights/detectors";
import { evaluateTips } from "../../supabase/functions/_shared/intelligence/tipPolicy";

const NOW = new Date("2026-09-29T15:00:00Z");

function ctx(): MultiFinanceProactiveContext {
  return {
    version: "proactive_multifinance.v1",
    user_id: "u1",
    as_of: "2026-09-29",
    monthly_income: 5000,
    materiality_floor: 100,
    available_today: 3000,
    projected_month_end_available: 500,
    daily_pace: 100,
    typical_daily_pace: 90,
    cash_horizon: [],
    first_negative_day: null,
    snapshot_ref: { reconciliation_id: "r", formula_version: "f" },
    domains: {
      cash: {}, cards: {}, goals: [], commitments: [], debts: [],
      debt_obligations: [], debt_obligations_available: true, patterns: [],
    },
    learning: {},
  };
}

function sit(over: Partial<FinancialSituation>): FinancialSituation {
  return {
    fingerprint: `fp:${over.communication_kind ?? "x"}:${over.type ?? "t"}`,
    type: "t",
    communication_kind: "spending_pace_change",
    severity: "attention",
    title: "Título",
    body: "Corpo com conteúdo suficiente.",
    primary_domain: "patterns",
    domains: ["patterns"],
    signals: [],
    impact_amount: 400,
    days_until: null,
    confidence: 0.85,
    actionable: true,
    route: null,
    priority_score: 0,
    score_reasons: [],
    evidence: {},
    ...over,
  };
}

describe("apresentação padronizada", () => {
  it("normaliza moeda em qualquer formato para pt-BR sem mudar o valor", () => {
    expect(normalizeMoneyText("Faltam R$ 10,800.00 até lá")).toBe(`Faltam ${brlPt(10800)} até lá`);
    expect(normalizeMoneyText("fechar R$ 6353,26")).toBe(`fechar ${brlPt(6353.26)}`);
    expect(normalizeMoneyText("parcela de R$ 300.00")).toBe(`parcela de ${brlPt(300)}`);
    expect(normalizeMoneyText("aluguel de R$ 1.200")).toBe(`aluguel de ${brlPt(1200)}`);
  });

  it("tira metodologia e jargão do corpo e cai numa ação concreta", () => {
    const out = presentSituation(sit({
      communication_kind: "cash_flow_imbalance",
      title: "Seus gastos de consumo superam a renda em R$ 2656,20",
      body: "O cálculo considera apenas renda operacional e consumo; pagamentos de fatura, transferências, dívidas e investimentos ficam fora para evitar dupla contagem.",
    }));
    expect(out.title).toContain(brlPt(2656.2));
    expect(out.body).not.toMatch(/cálculo considera/);
    expect(out.body.length).toBeGreaterThan(12);
    expect((out.evidence as any).presentation.methodology.length).toBeGreaterThan(0);
  });

  it("troca 'no vermelho' por linguagem neutra", () => {
    const out = presentSituation(sit({ title: "O mês deve fechar R$ 500,00 no vermelho" }));
    expect(out.title).not.toMatch(/vermelho/);
  });

  it("classifica itens do diagnóstico pelo assunto, não tudo como emoção", () => {
    expect(diagnosisCommunicationKind("risk", "situation:future:goal-1")).toBe("goal_at_risk");
    expect(diagnosisCommunicationKind("risk", "situation:cash_flow")).toBe("cash_flow_imbalance");
    expect(diagnosisCommunicationKind("achievement", "situation:debt_progress")).toBe("debt_progress");
    expect(diagnosisCommunicationKind("pattern", "situation:emotional_checkin_gap")).toBe("emotional_spending");
  });
});

describe("qualidade do dado", () => {
  const missing = assessDataQuality({
    today: "2026-09-29", current_month_income: 21, expected_income_rest_of_month: 0,
    previous_months_income: [5200, 5000, 5100], first_entry_date: "2026-05-01", last_entry_date: "2026-09-28",
  });

  it("renda muito abaixo do habitual é renda incompleta, não crise", () => {
    expect(missing.income_status).toBe("partial");
    expect(missing.income_reliable).toBe(false);
    expect(missing.pace_reliable).toBe(true);
  });

  it("rebaixa só o que depende de renda e pede o dado no lugar", () => {
    const refined = applyDataQuality([
      sit({ communication_kind: "cash_flow_imbalance", fingerprint: "cash" }),
      sit({ communication_kind: "debt_overdue", severity: "critical", fingerprint: "debt" }),
    ], missing);
    expect(refined[0].confidence).toBeLessThan(0.6);
    expect(refined[1].confidence).toBe(0.85);
    const request = incomeDataRequest(missing, refined, "2026-09-29");
    expect(request?.communication_kind).toBe("data_quality");
    expect(request?.body).not.toMatch(/R\$/);

    const { decisions } = allocateAttention({ situations: [...refined, request!], ctx: ctx(), channels: ["app"] });
    expect(decisions.find((d) => d.fingerprint === "cash")?.reason).toBe("confidence_too_low");
    expect(decisions.find((d) => d.fingerprint === request!.fingerprint)?.decision).toBe("deliver");
  });

  it("histórico curto não sustenta comparação de ritmo", () => {
    const young = assessDataQuality({
      today: "2026-09-29", current_month_income: 5000, expected_income_rest_of_month: 0,
      previous_months_income: [], first_entry_date: "2026-09-10", last_entry_date: "2026-09-28",
    });
    expect(young.pace_reliable).toBe(false);
    const [pace] = applyDataQuality([sit({ communication_kind: "spending_pace_change" })], young);
    expect(pace.confidence).toBeLessThan(0.6);
  });

  it("renda completa não mexe em nada", () => {
    const ok = assessDataQuality({
      today: "2026-09-29", current_month_income: 5000, expected_income_rest_of_month: 0,
      previous_months_income: [5000], first_entry_date: "2026-01-01", last_entry_date: "2026-09-28",
    });
    const input = [sit({ communication_kind: "cash_flow_imbalance" })];
    expect(applyDataQuality(input, ok)).toEqual(input);
    expect(incomeDataRequest(ok, input, "2026-09-29")).toBeNull();
  });
});

describe("modelo do usuário: metas e memória", () => {
  const model = buildUserModel({
    today: "2026-09-29",
    goals: [
      { id: "g1", name: "Viagem", target_amount: 10000, saved_amount: 1500, target_date: "2026-12-15", monthly_target: null },
      { id: "g2", name: "Reserva", target_amount: 20000, saved_amount: 0, target_date: "2027-12-01", monthly_target: null },
    ],
    lifeNotes: ["Vai viajar pro nordeste em dezembro com a esposa"],
  });

  it("reconhece a meta citada na conversa e a usa como foco", () => {
    expect(model.goals.find((g) => g.id === "g1")?.mentioned).toBe(true);
    expect(model.focus_goal?.id).toBe("g1");
    expect(model.focus_goal?.monthly_need).toBeCloseTo(8500 / 3, 1);
  });

  it("liga um gasto relevante à meta com a conta feita no código", () => {
    const [linked] = applyUserModel([sit({ communication_kind: "spending_pace_change", impact_amount: 850 })], model);
    expect(linked.body).toMatch(/30% do que a meta “Viagem” precisa por mês/);
    expect((linked.evidence as any).relevance_boost).toBeGreaterThan(0);
  });

  it("não inventa ligação para gasto pequeno", () => {
    const [same] = applyUserModel([sit({ communication_kind: "spending_pace_change", impact_amount: 100 })], model);
    expect(same.body).toBe("Corpo com conteúdo suficiente.");
  });

  it("situação sobre a meta citada sobe no ranking", () => {
    const about = sit({ fingerprint: "goal", communication_kind: "goal_at_risk", title: "Sua meta Viagem pede aporte", primary_domain: "goals", impact_amount: 300 });
    const other = sit({ fingerprint: "other", communication_kind: "goal_at_risk", title: "Outra coisa", primary_domain: "cash", impact_amount: 300 });
    const ranked = scoreSituations(applyUserModel([other, about], model), ctx());
    expect(ranked[0].fingerprint).toBe("goal");
    expect(ranked[0].score_reasons.some((r) => r.startsWith("user_relevance:"))).toBe(true);
  });
});

describe("anti-repetição por assunto", () => {
  const recent = [{ kind: "spending_pace_change", channel: "whatsapp", delivered_at: "2026-09-28T12:00:00Z", impact_amount: 400 }];

  it("o mesmo tipo não volta no mesmo canal dentro da janela", () => {
    expect(repeatedKind(sit({ impact_amount: 420 }), "whatsapp", recent, NOW)).toMatch(/kind_repeat_window/);
  });

  it("volta se o impacto cresceu de forma material", () => {
    expect(repeatedKind(sit({ impact_amount: 700 }), "whatsapp", recent, NOW)).toBeNull();
  });

  it("risco crítico nunca espera", () => {
    expect(repeatedKind(sit({ severity: "critical" }), "whatsapp", recent, NOW)).toBeNull();
  });

  it("o alocador aplica a janela", () => {
    const { decisions } = allocateAttention({
      situations: [sit({ fingerprint: "pace" })], ctx: ctx(), channels: ["whatsapp"], recentDeliveries: recent, now: NOW,
    });
    expect(decisions[0].reason).toMatch(/kind_repeat_window/);
  });
});

describe("motor de dicas (catálogo)", () => {
  const base = {
    cardDebtToday: 0, cardFutureInstallments: 0, cardDebtIsEstimated: false, statementsDueIn7d: [],
    activeDebtTotal: 0, expenseMonth: 508, incomeMonth: 21, upcomingCommitments7d: 0,
  };

  it("não alarma 'gastou mais do que entrou' com renda incompleta", () => {
    const withGap = deterministicCandidates({ ...base, incomeReliable: false });
    expect(withGap.some((c) => c.detector === "financial_risk")).toBe(false);
    expect(deterministicCandidates(base).some((c) => c.detector === "financial_risk")).toBe(true);
  });

  it("ritmo só vira dica quando o mês vai fechar acima do anterior", () => {
    const rhythm = { dailyTypical: 100, daysLeft: 5, projectedExpense: 3000 };
    expect(deterministicCandidates({ ...base, rhythm }).some((c) => c.detector === "spending_rhythm")).toBe(false);
    expect(deterministicCandidates({ ...base, rhythm, previousMonthExpense: 2900 }).some((c) => c.detector === "spending_rhythm")).toBe(false);
    const up = deterministicCandidates({ ...base, rhythm, previousMonthExpense: 2000 }).find((c) => c.detector === "spending_rhythm");
    expect(up?.body).toMatch(/mês passado/);
  });

  it("hábito de comerciante precisa pesar no mês", () => {
    const small = deterministicCandidates({ ...base, expenseMonth: 4000, recurringMerchant: { name: "uber", occurrences: 6, total: 105 } });
    expect(small.some((c) => c.detector === "recurring_merchant")).toBe(false);
  });

  it("anomalia cita a categoria quando conhecida", () => {
    const out = deterministicCandidates({
      ...base, amountAnomaly: { description: "Show", amount: 292, typicalAmount: 40, occurredAt: "2026-09-28", category: "Lazer" },
    }).find((c) => c.detector === "amount_anomaly");
    expect(out?.body).toMatch(/costuma gastar em Lazer/);
  });

  it("a mesma dica não volta em 72h mesmo sem feedback", () => {
    const candidate = { type: "alert", title: "Gasto fora do padrão", body: "b", cta_label: "c", cta_route: "/app/lancamentos", model: "deterministic" };
    const [decision] = evaluateTips([candidate], [
      { kind: "alert", family: "gastos", dedup_key: "alert:gasto-fora-do-padrao", created_at: "2026-09-28T09:00:00Z", status: "expired" },
    ], { now: NOW });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("repeat_cooldown");
  });
});

describe("ajustes da simulação com dados reais", () => {
  it("pedido de renda passa pelo piso de valor", () => {
    const dq = assessDataQuality({
      today: "2026-09-29", current_month_income: 0, expected_income_rest_of_month: 0,
      previous_months_income: [], first_entry_date: "2026-08-01", last_entry_date: "2026-09-20",
    });
    const blocked = applyDataQuality([sit({ communication_kind: "cash_flow_imbalance", fingerprint: "c" })], dq);
    const request = incomeDataRequest(dq, blocked, "2026-09-29")!;
    expect(dq.income_status).toBe("unknown");
    const { decisions } = allocateAttention({ situations: [...blocked, request], ctx: ctx(), channels: ["app", "whatsapp"] });
    const forRequest = decisions.filter((d) => d.fingerprint === request.fingerprint);
    expect(forRequest.find((d) => d.channel === "app")?.decision).toBe("deliver");
    expect(forRequest.find((d) => d.channel === "whatsapp")?.reason).toBe("app_only_kind");
  });

  it("sem histórico, renda ínfima contra muito gasto é renda incompleta", () => {
    const dq = assessDataQuality({
      today: "2026-09-29", current_month_income: 300, current_month_expense: 3000, expected_income_rest_of_month: 0,
      previous_months_income: [], first_entry_date: "2026-08-01", last_entry_date: "2026-09-28",
    });
    expect(dq.income_status).toBe("partial");
  });

  it("um assunto por canal por rodada", () => {
    const { decisions } = allocateAttention({
      situations: [
        sit({ fingerprint: "a", communication_kind: "cash_flow_imbalance", impact_amount: 2000 }),
        sit({ fingerprint: "b", communication_kind: "cash_flow_imbalance", impact_amount: 1500 }),
      ],
      ctx: ctx(), channels: ["app"],
    });
    expect(decisions.map((d) => d.reason)).toEqual(["top_ranked_material_situation", "same_kind_in_round"]);
  });

  it("parcela de dívida do diagnóstico não vira 'meta' e não duplica a fonte canônica", () => {
    expect(diagnosisCommunicationKind("opportunity", "situation:future:debt:x")).toBe("debt_due_soon");
    expect(diagnosisCommunicationKind("risk", "situation:future:goal:x")).toBe("goal_at_risk");
    expect(diagnosisCommunicationKind("opportunity", "situation:anticipation:x")).toBe("small_spend_acceleration");
  });
});
