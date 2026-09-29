// nino_highlights_eval.v1 — avaliação de ponta a ponta dos destaques.
// Cada cenário é um usuário típico; o mesmo encadeamento do pipeline de
// produção decide o que vai para o app, para o WhatsApp e para a fila.
// As métricas agregadas no final têm limites: se uma mudança piorar a
// qualidade dos destaques, o CI falha.
import { describe, expect, it } from "vitest";
import type { FinancialSituation, MultiFinanceProactiveContext } from "../../supabase/functions/_shared/proactive/contracts";
import { presentSituation } from "../../supabase/functions/_shared/proactive/presentation";
import { applyDataQuality, assessDataQuality, incomeDataRequest, type DataQualityInput } from "../../supabase/functions/_shared/proactive/dataQuality";
import { applyUserModel, buildUserModel, type UserGoalInput } from "../../supabase/functions/_shared/proactive/userModel";
import { applyLearningAdjustment, learnFromPriorityEvents, mergeLearning, type PriorityEvent } from "../../supabase/functions/_shared/proactive/priorityLearning";
import { allocateAttention } from "../../supabase/functions/_shared/proactive/ranking";
import { buildPriorityFeed } from "../../supabase/functions/_shared/proactive/priorityFeed";
import type { RecentDelivery } from "../../supabase/functions/_shared/proactive/repetition";

const NOW = new Date("2026-09-29T15:00:00Z");
const TODAY = "2026-09-29";

const HEALTHY_DQ: DataQualityInput = {
  today: TODAY, current_month_income: 6000, expected_income_rest_of_month: 0,
  previous_months_income: [6000, 6100, 5900], first_entry_date: "2026-01-02", last_entry_date: "2026-09-28",
};

type Scenario = {
  name: string;
  situations: FinancialSituation[];
  dq?: Partial<DataQualityInput>;
  goals?: UserGoalInput[];
  lifeNotes?: string[];
  recent?: RecentDelivery[];
  events?: PriorityEvent[];
};

function ctx(): MultiFinanceProactiveContext {
  return {
    version: "proactive_multifinance.v1", user_id: "u", as_of: TODAY, monthly_income: 6000, materiality_floor: 120,
    available_today: 2500, projected_month_end_available: 300, daily_pace: 150, typical_daily_pace: 120,
    cash_horizon: [], first_negative_day: null, snapshot_ref: { reconciliation_id: "r", formula_version: "f" },
    domains: { cash: {}, cards: {}, goals: [], commitments: [], debts: [], debt_obligations: [], debt_obligations_available: true, patterns: [] },
    learning: {},
  };
}

function sit(over: Partial<FinancialSituation> & { fingerprint: string; communication_kind: string }): FinancialSituation {
  return {
    type: over.communication_kind, severity: "attention", title: "Título", body: "Corpo com conteúdo suficiente.",
    primary_domain: "patterns", domains: ["patterns"], signals: [], impact_amount: 500, days_until: null,
    confidence: 0.85, actionable: true, route: "/app/relatorios", priority_score: 0, score_reasons: [], evidence: {},
    ...over,
  };
}

/** Mesmo encadeamento do `runMultiFinanceProactive` (sem I/O). */
function run(scenario: Scenario) {
  const context = ctx();
  const dq = assessDataQuality({ ...HEALTHY_DQ, ...(scenario.dq ?? {}) });
  const model = buildUserModel({ today: TODAY, goals: scenario.goals ?? [], lifeNotes: scenario.lifeNotes ?? [] });
  const learned = learnFromPriorityEvents(scenario.events ?? [], NOW);
  context.learning = mergeLearning(context.learning, learned);

  let refined = scenario.situations.map(presentSituation);
  refined = applyDataQuality(refined, dq);
  const request = incomeDataRequest(dq, refined, TODAY);
  if (request) refined.push(request);
  refined = applyUserModel(refined, model);
  refined = applyLearningAdjustment(refined, learned);

  const allocation = allocateAttention({
    situations: refined, ctx: context, channels: ["app", "whatsapp"], recentDeliveries: scenario.recent ?? [], now: NOW,
  });
  const feed = buildPriorityFeed(allocation.ranked, context);
  const delivered = (channel: string) => allocation.decisions
    .filter((d) => d.channel === channel && d.decision === "deliver")
    .map((d) => allocation.ranked.find((s) => s.fingerprint === d.fingerprint)!);
  return { dq, allocation, feed, app: delivered("app"), whatsapp: delivered("whatsapp"), ranked: allocation.ranked };
}

const INCOME_DEPENDENT = new Set(["cash_flow_imbalance", "goal_feasibility", "wealth_building_action"]);
const US_OR_UNGROUPED_MONEY = /R\$\s?\d{1,3}(?:,\d{3})+\.\d{2}|R\$\s?\d{4,},\d{2}/;
const JARGON = /no vermelho|O cálculo considera|amostras|confiança de \d/i;

const SCENARIOS: Scenario[] = [
  {
    name: "renda não registrada",
    dq: { current_month_income: 0, previous_months_income: [5000, 5100, 4900] },
    situations: [
      sit({ fingerprint: "cash", communication_kind: "cash_flow_imbalance", title: "Seus gastos de consumo superam a renda em R$ 2.680,50", impact_amount: 2680.5 }),
      sit({ fingerprint: "shortfall", communication_kind: "cash_flow_imbalance", type: "month_end_shortfall", title: "O mês deve fechar R$ 6353,26 no vermelho", impact_amount: 6353.26 }),
    ],
  },
  {
    name: "dívida vencida e meta citada na conversa",
    goals: [{ id: "g1", name: "Viagem", target_amount: 10000, saved_amount: 1500, target_date: "2026-12-15", monthly_target: null }],
    lifeNotes: ["Vai viajar pro nordeste em dezembro com a esposa"],
    situations: [
      sit({ fingerprint: "debt", communication_kind: "debt_overdue", severity: "critical", title: "Parcela de Celular venceu ontem", impact_amount: 500, days_until: -1, primary_domain: "debts" }),
      sit({ fingerprint: "goal", communication_kind: "goal_at_risk", title: "Sua meta Viagem pede um próximo aporte", body: "Para Viagem faltam R$ 8,500.00 até 15/12/2026.", impact_amount: 8500, primary_domain: "goals" }),
      sit({ fingerprint: "pace", communication_kind: "spending_pace_change", title: "Seu ritmo está acima do típico", impact_amount: 900 }),
    ],
  },
  {
    name: "mesmo assunto ontem no WhatsApp",
    recent: [{ kind: "spending_pace_change", channel: "whatsapp", delivered_at: "2026-09-28T13:00:00Z", impact_amount: 600 }],
    situations: [sit({ fingerprint: "pace", communication_kind: "spending_pace_change", title: "Seu ritmo está acima do típico", impact_amount: 650 })],
  },
  {
    name: "pessoa dispensa um tipo e ignora outro",
    events: [
      { kind: "growing_category", fingerprint: "g1", event: "dismissed", created_at: "2026-09-20T10:00:00Z" },
      { kind: "growing_category", fingerprint: "g2", event: "dismissed", created_at: "2026-09-25T10:00:00Z" },
      ...[1, 2, 3].map((i) => ({ kind: "emotional_spending", fingerprint: `e${i}`, event: "next_requested", created_at: `2026-09-2${i}T10:00:00Z` })),
      { kind: "debt_due_soon", fingerprint: "d1", event: "acted", created_at: "2026-09-26T10:00:00Z" },
    ],
    situations: [
      sit({ fingerprint: "grow", communication_kind: "growing_category", title: "Lazer subiu neste mês", impact_amount: 800 }),
      sit({ fingerprint: "emo", communication_kind: "emotional_spending", title: "Gasto ajustável maior no meio do mês", impact_amount: 700 }),
      sit({ fingerprint: "due", communication_kind: "debt_due_soon", title: "Parcela de Lucas vence em 10/10", impact_amount: 300, days_until: 11 }),
    ],
  },
  {
    name: "dois avisos do mesmo tipo e texto técnico",
    situations: [
      sit({ fingerprint: "c1", communication_kind: "cash_flow_imbalance", title: "Seus gastos de consumo superam a renda em R$ 1322,46", body: "O cálculo considera apenas renda operacional e consumo; pagamentos de fatura ficam fora para evitar dupla contagem.", impact_amount: 1322.46 }),
      sit({ fingerprint: "c2", communication_kind: "cash_flow_imbalance", title: "O mês deve fechar R$ 1.100,00 negativo", impact_amount: 1100 }),
    ],
  },
];

describe("nino_highlights_eval.v1 — cenários", () => {
  const results = new Map(SCENARIOS.map((s) => [s.name, run(s)]));

  it("renda não registrada: nenhum alarme de sobra; pedido de renda só no app", () => {
    const r = results.get("renda não registrada")!;
    expect(r.app.map((s) => s.communication_kind)).toEqual(["data_quality"]);
    expect(r.whatsapp).toHaveLength(0);
    expect(r.feed[0].kind).toBe("data_quality");
  });

  it("dívida vencida lidera; meta citada vem logo depois; gasto liga à meta", () => {
    const r = results.get("dívida vencida e meta citada na conversa")!;
    expect(r.feed.map((i) => i.kind)).toEqual(["debt_overdue", "goal_at_risk", "spending_pace_change"]);
    expect(r.whatsapp.map((s) => s.fingerprint)).toEqual(["debt"]);
    expect(r.feed[2].body).toMatch(/meta “Viagem” precisa por mês/);
  });

  it("repetição: não volta no WhatsApp, mas segue na fila do app", () => {
    const r = results.get("mesmo assunto ontem no WhatsApp")!;
    expect(r.whatsapp).toHaveLength(0);
    expect(r.feed.map((i) => i.fingerprint)).toEqual(["pace"]);
  });

  it("aprendizado: tipo dispensado some, ignorado cai, agido sobe", () => {
    const r = results.get("pessoa dispensa um tipo e ignora outro")!;
    const order = r.feed.map((i) => i.kind);
    expect(order).not.toContain("growing_category");
    expect(order.indexOf("debt_due_soon")).toBeLessThan(order.indexOf("emotional_spending"));
  });

  it("um aviso por tipo e texto sem jargão", () => {
    const r = results.get("dois avisos do mesmo tipo e texto técnico")!;
    expect(r.feed.filter((i) => i.kind === "cash_flow_imbalance")).toHaveLength(1);
    expect(r.feed[0].body).not.toMatch(JARGON);
  });
});

describe("nino_highlights_eval.v1 — métricas agregadas (limites do CI)", () => {
  const all = SCENARIOS.map((s) => ({ scenario: s, result: run(s) }));
  const surfaced = all.flatMap(({ result }) => [...result.app, ...result.whatsapp, ...result.ranked.filter((s) => result.feed.some((f) => f.fingerprint === s.fingerprint))]);

  it("falso alarme por dado incompleto = 0", () => {
    const falseAlarms = all.flatMap(({ result }) =>
      result.dq.income_reliable ? [] : [...result.app, ...result.whatsapp].filter((s) => INCOME_DEPENDENT.has(s.communication_kind)));
    expect(falseAlarms).toHaveLength(0);
  });

  it("repetição no mesmo canal dentro da janela = 0", () => {
    const violations = all.flatMap(({ scenario, result }) => result.whatsapp.filter((s) =>
      (scenario.recent ?? []).some((d) => d.channel === "whatsapp" && d.kind === s.communication_kind) && s.severity !== "critical"));
    expect(violations).toHaveLength(0);
  });

  it("risco crítico nunca é silenciado por aprendizado ou repetição", () => {
    for (const { result } of all) {
      for (const critical of result.ranked.filter((s) => s.severity === "critical")) {
        const decisions = result.allocation.decisions.filter((d) => d.fingerprint === critical.fingerprint);
        expect(decisions.some((d) => d.decision === "deliver")).toBe(true);
      }
    }
  });

  it("formato de dinheiro e vocabulário: 0 violações no que chega ao usuário", () => {
    const bad = surfaced.filter((s) => US_OR_UNGROUPED_MONEY.test(`${s.title} ${s.body}`) || JARGON.test(`${s.title} ${s.body}`));
    expect(bad.map((s) => `${s.title} | ${s.body}`)).toEqual([]);
  });

  it("no máximo 1 interrupção de WhatsApp por rodada", () => {
    for (const { result } of all) expect(result.whatsapp.length).toBeLessThanOrEqual(1);
  });

  it("com meta ativa, a maioria dos destaques de gasto/meta se conecta a ela", () => {
    const withGoals = all.filter(({ scenario }) => (scenario.goals ?? []).length > 0);
    const relevant = withGoals.flatMap(({ result }) => result.feed.filter((i) => i.kind !== "debt_overdue"));
    const linked = relevant.filter((i) => (i.evidence.user_model as any)?.reasons?.length);
    expect(linked.length / Math.max(1, relevant.length)).toBeGreaterThanOrEqual(0.5);
  });
});
