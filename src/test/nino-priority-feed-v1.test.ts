import { describe, expect, it } from "vitest";
import { buildPriorityFeed } from "../../supabase/functions/_shared/proactive/priorityFeed";
import type { FinancialSituation, MultiFinanceProactiveContext } from "../../supabase/functions/_shared/proactive/contracts";
import { formatDailyPriorities } from "../../supabase/functions/_shared/agent/core/DeterministicAnswersImpl";

const ctx = {
  version: "proactive_multifinance.v1", user_id: "u1", as_of: "2026-09-29", monthly_income: 5000,
  materiality_floor: 100, available_today: 3000, projected_month_end_available: 500, daily_pace: 100,
  typical_daily_pace: 90, cash_horizon: [], first_negative_day: null,
  snapshot_ref: { reconciliation_id: "r", formula_version: "f" },
  domains: { cash: {}, cards: {}, goals: [], commitments: [], debts: [], debt_obligations: [], debt_obligations_available: true, patterns: [] },
  learning: {},
} as MultiFinanceProactiveContext;

function sit(over: Partial<FinancialSituation>): FinancialSituation {
  return {
    fingerprint: "fp", type: "t", communication_kind: "goal_at_risk", severity: "attention",
    title: "T", body: "B", primary_domain: "goals", domains: ["goals"], signals: [],
    impact_amount: 500, days_until: null, confidence: 0.9, actionable: true, route: "/app/metas",
    priority_score: 100, score_reasons: [], evidence: {}, ...over,
  };
}

describe("nino_priority_feed.v1", () => {
  it("ordena por score, um assunto por tipo, e respeita aprendizado, confiança e materialidade", () => {
    const feed = buildPriorityFeed([
      sit({ fingerprint: "low", priority_score: 50, communication_kind: "debt_progress" }),
      sit({ fingerprint: "top", priority_score: 160, communication_kind: "debt_overdue", severity: "critical" }),
      sit({ fingerprint: "dup", priority_score: 150, communication_kind: "debt_overdue" }),
      sit({ fingerprint: "muted", priority_score: 140, communication_kind: "growing_category", score_reasons: ["muted_by_learning"] }),
      sit({ fingerprint: "unsure", priority_score: 130, communication_kind: "cash_flow_imbalance", confidence: 0.4 }),
      sit({ fingerprint: "tiny", priority_score: 120, communication_kind: "spending_pace_change", impact_amount: 5 }),
      sit({ fingerprint: "goal", priority_score: 110 }),
      sit({ fingerprint: "ask", priority_score: 40, communication_kind: "data_quality", severity: "info", impact_amount: 0 }),
    ], ctx);
    expect(feed.map((i) => i.fingerprint)).toEqual(["top", "goal", "low", "ask"]);
    expect(feed.map((i) => i.rank)).toEqual([1, 2, 3, 4]);
  });

  it("limita o tamanho da fila", () => {
    const many = Array.from({ length: 9 }, (_, i) => sit({ fingerprint: `f${i}`, communication_kind: `k${i}`, priority_score: 100 - i }));
    expect(buildPriorityFeed(many, ctx)).toHaveLength(5);
  });

  it("o chat lista a fila em ordem, sem recalcular", () => {
    const text = formatDailyPriorities({ items: [
      { title: "Parcela de Celular venceu ontem", body: "São R$ 500,00." },
      { title: "Sua meta pede aporte", body: "" },
    ] });
    expect(text).toContain("1. *Parcela de Celular venceu ontem* — São R$ 500,00.");
    expect(text).toContain("2. *Sua meta pede aporte*");
    expect(formatDailyPriorities({ items: [] })).toMatch(/nenhum ponto novo/);
  });
});

import { learnFromPriorityEvents, applyLearningAdjustment, mergeLearning } from "../../supabase/functions/_shared/proactive/priorityLearning";

describe("nino_priority_learning.v1", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  const ev = (kind: string, event: string, day = 25, fp = `${kind}-${event}-${day}`) =>
    ({ kind, event, fingerprint: fp, created_at: `2026-09-${day}T10:00:00Z` });

  it("explícito vira ação/dispensa; implícito vira só penalidade limitada", () => {
    const learned = learnFromPriorityEvents([
      ev("goal_at_risk", "acted"), ev("growing_category", "dismissed"),
      ...Array.from({ length: 10 }, (_, i) => ev("emotional_spending", "next_requested", 10 + i)),
    ], now);
    expect(learned.explicit.goal_at_risk).toEqual({ dismissals: 0, actions: 1 });
    expect(learned.explicit.growing_category).toEqual({ dismissals: 1, actions: 0 });
    expect(learned.adjustment.emotional_spending).toBe(-30);
    expect(mergeLearning({ goal_at_risk: { dismissals: 0, actions: 2, false_positives: 0 } }, learned).goal_at_risk.actions).toBe(3);
  });

  it("ver muitas vezes sem agir penaliza; agir anula; eventos antigos não contam", () => {
    const ignored = Array.from({ length: 5 }, (_, i) => ev("spending_pace_change", "impression", 20 + i, `p${i}`));
    expect(learnFromPriorityEvents(ignored, now).adjustment.spending_pace_change).toBe(-10);
    expect(learnFromPriorityEvents([...ignored, ev("spending_pace_change", "acted")], now).adjustment.spending_pace_change).toBeUndefined();
    const old = [{ kind: "x", event: "dismissed", fingerprint: "o", created_at: "2026-06-01T10:00:00Z" }];
    expect(learnFromPriorityEvents(old, now).explicit.x).toBeUndefined();
  });

  it("penalidade implícita nunca atinge risco crítico", () => {
    const learned = { explicit: {}, adjustment: { debt_overdue: -30, growing_category: -10 } };
    const [critical, other] = applyLearningAdjustment([
      sit({ communication_kind: "debt_overdue", severity: "critical" }),
      sit({ communication_kind: "growing_category" }),
    ], learned);
    expect((critical.evidence as any).learning_adjustment).toBeUndefined();
    expect((other.evidence as any).learning_adjustment).toBe(-10);
  });
});

describe("ordem da fila", () => {
  it("risco crítico lidera mesmo com nota menor que um item relevante", () => {
    const feed = buildPriorityFeed([
      sit({ fingerprint: "goal", communication_kind: "goal_at_risk", priority_score: 140 }),
      sit({ fingerprint: "crit", communication_kind: "goal_feasibility", severity: "critical", priority_score: 135 }),
    ], ctx);
    expect(feed.map((i) => i.fingerprint)).toEqual(["crit", "goal"]);
  });
});
