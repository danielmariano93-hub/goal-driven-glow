import { describe, expect, it } from "vitest";
import {
  detectEngagementDrop,
  detectRecurringPattern,
} from "../../supabase/functions/_shared/agent/core/ProactiveDetectors";
import {
  detectEmotionalSpending,
  detectFinancialProcrastination,
  runBehaviorDetectors,
} from "../../supabase/functions/_shared/agent/core/BehaviorDetectors";
import { buildAdvisorReview } from "../../supabase/functions/_shared/agent/core/AdvisorReviewService";
import { decideCommunication } from "../../supabase/functions/_shared/intelligence/communicationPolicy";

const now = new Date("2026-07-28T12:00:00-03:00");

describe("product completion core", () => {
  it("detecta queda de engajamento somente com histórico suficiente", () => {
    expect(detectEngagementDrop({
      last_30_days: 1,
      previous_30_days: 8,
      days_since_last_activity: 14,
      last_activity_at: "2026-07-14T12:00:00Z",
    })).toHaveLength(1);
    expect(detectEngagementDrop({
      last_30_days: 0,
      previous_30_days: 2,
      days_since_last_activity: 20,
    })).toHaveLength(0);
  });

  it("detecta recorrência com intervalo e valores consistentes", () => {
    const rows = [
      ["2026-04-10", 99.9],
      ["2026-05-10", 99.9],
      ["2026-06-09", 102],
      ["2026-07-10", 99.9],
    ].map(([date, amount], index) => ({
      id: String(index),
      amount: Number(amount),
      description: "Streaming Premium",
      occurred_at: `${date}T12:00:00Z`,
      type: "expense",
      movement_kind: "transaction",
    }));
    const result = detectRecurringPattern(rows);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("recurring_pattern");
  });

  it("exige amostra mínima para hipótese emocional", () => {
    const few = detectEmotionalSpending({
      transactions: [{
        id: "1", amount: 100, occurred_at: "2026-07-01T12:00:00Z",
        type: "expense", movement_kind: "transaction",
      }],
      checkins: [{ occurred_at: "2026-07-01T08:00:00Z", mood: 1 }],
      recurring: [],
      now,
    });
    expect(few).toHaveLength(0);
  });

  it("gera hipótese emocional explicável quando a diferença é consistente", () => {
    const days = Array.from({ length: 10 }, (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`);
    const transactions = days.map((day, index) => ({
      id: String(index),
      amount: index < 4 ? 200 : 80,
      occurred_at: `${day}T12:00:00Z`,
      type: "expense",
      movement_kind: "transaction",
    }));
    const checkins = days.map((day, index) => ({
      occurred_at: `${day}T08:00:00Z`,
      mood: index < 4 ? 2 : 4,
    }));
    const result = detectEmotionalSpending({ transactions, checkins, recurring: [], now });
    expect(result).toHaveLength(1);
    expect(result[0].evidence).toMatchObject({ paired_days: 10, low_mood_days: 4 });
  });

  it("marca compromissos vencidos como hipótese, não diagnóstico", () => {
    const result = detectFinancialProcrastination({
      transactions: [],
      checkins: [],
      recurring: [
        { id: "1", due_date: "2026-07-01", status: "pending", description: "Conta A" },
        { id: "2", due_date: "2026-07-10", status: "pending", description: "Conta B" },
      ],
      now,
    });
    expect(result[0].explanation.toLowerCase()).toContain("pode indicar");
  });

  it("aplica dedup exato por 14 dias e limite diário", () => {
    const candidate = {
      id: "s1",
      user_id: "u1",
      kind: "spending_spike",
      severity: "attention" as const,
      title: "Atenção",
      body: "Teste",
      channel_ready: "both" as const,
      dedup_key: "spike:2026-07",
    };

    const exact = decideCommunication({
      candidate,
      target: "app",
      preferences: {
        proactive_financial: true,
        max_proactive_per_day: 3,
        max_proactive_per_week: 5,
      },
      history: [{
        created_at: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
        kind: "spending_spike",
        channel: "app",
        status: "delivered",
        dedup_key: "spike:2026-07",
      }],
      now,
    });
    expect(exact.reason).toBe("dedup_key_14d");

    const capped = decideCommunication({
      candidate: { ...candidate, dedup_key: "spike:new" },
      target: "app",
      preferences: {
        proactive_financial: true,
        max_proactive_per_day: 1,
        max_proactive_per_week: 5,
      },
      history: [{
        created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        kind: "goal_at_risk",
        channel: "app",
        status: "delivered",
        dedup_key: "goal:1",
      }],
      now,
    });
    expect(capped.reason).toBe("daily_frequency_cap");
  });

  it("respeita silêncio por tipo", () => {
    const decision = decideCommunication({
      candidate: {
        id: "s1", user_id: "u1", kind: "recurring_pattern", severity: "info",
        title: "Padrão", body: "Teste", channel_ready: "app", dedup_key: "rec:1",
      },
      target: "app",
      preferences: {
        proactive_financial: true,
        muted_proactive_kinds: ["recurring_pattern"],
      },
      history: [],
      now,
    });
    expect(decision.reason).toBe("kind_opt_out");
  });

  it("constrói revisão do assessor sem inventar perfil de risco", () => {
    const profile = {
      user_id: "u1",
      estimated_income: 5000,
      savings_capacity: 1000,
      net_worth: 10000,
      risk_level: null,
      behavior_tags: ["poupador"],
      spending_pattern: { Alimentação: 1000 },
      seasonality: {},
      monthly_evolution: [
        { month: "2026-05", income: 5000, expense: 4000, net: 1000 },
        { month: "2026-06", income: 5000, expense: 3900, net: 1100 },
        { month: "2026-07", income: 5000, expense: 4000, net: 1000 },
      ],
      top_categories: [{ category: "Alimentação", total: 1000, share: 0.25 }],
      indicators: {
        savings_rate: 0.2,
        months_observed: 3,
      },
      computed_at: now.toISOString(),
    };
    const review = buildAdvisorReview(profile, null, "weekly", now);
    expect(review.actions.length).toBeGreaterThan(0);
    expect(review.summary.indicators).not.toHaveProperty("risk_level");
  });

  it("não gera hipóteses abaixo do limiar de confiança", () => {
    const result = runBehaviorDetectors({
      transactions: [],
      checkins: [],
      recurring: [],
      now,
    });
    expect(result).toEqual([]);
  });
});
