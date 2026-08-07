import { describe, expect, it } from "vitest";
import { computeGoalOverview } from "@/lib/goals/summary";
import { consolidateSituations } from "@/lib/nino/consolidate";
import { emotionalReminderDue } from "../../supabase/functions/_shared/intelligence/emotionalReminder";
import { simulateSpending } from "@/lib/engine/spendingSimulation";

describe("entrega corretiva única", () => {
  it("resume metas financeiras e de categoria sem tratar doação como ganho", () => {
    const overview = computeGoalOverview({
      month: "2026-08",
      goals: [
        { id: "save", kind: "savings", target_amount: 1000 },
        { id: "give", kind: "donation", target_amount: 100, monthly_target: 100, donation_mode: "fixed" },
      ],
      contributions: [
        { goal_id: "save", amount: 200, occurred_at: "2026-08-05" },
        { goal_id: "give", amount: 100, occurred_at: "2026-08-05" },
      ],
      investments: [],
      categoryGoals: [{ baselineAmount: 500, targetAmount: 400, actualSpend: 350, goal: { status: "active" } } as never],
    });
    expect(overview.positiveImpactThisMonth).toBe(350);
    expect(overview.byType.financial).toBe(20);
    expect(overview.byType.category).toBe(100);
    expect(overview.byType.donation).toBe(100);
  });

  it("consolida cards semanticamente repetidos e preserva o mais relevante", () => {
    const base = {
      situation_type: "behavioral_pattern", status: "active", temporal_scope: "now", severity: "attention",
      confidence: 0.8, period_start: null, period_end: null, current_value: null, baseline_value: null,
      absolute_delta: null, percentage_delta: null, impact_amount: null, narrative_role: "support",
      cause_summary: null, consequence_summary: null, forecast_summary: null, evaluation: {},
      valid_from: "2026-08-01", valid_until: null,
    } as const;
    const result = consolidateSituations([
      { ...base, id: "11111111-1111-4111-8111-111111111111", situation_key: "a", relevance_score: 90, headline: "Gastos maiores no fim de semana", one_line_summary: "Fim de semana concentra gastos" },
      { ...base, id: "22222222-2222-4222-8222-222222222222", situation_key: "b", relevance_score: 70, headline: "Fim de semana concentra seus gastos", one_line_summary: "Gastos maiores no fim de semana" },
    ] as never);
    expect(result).toHaveLength(1);
    expect(result[0].relevance_score).toBe(90);
    expect(result[0].evaluation.consolidated_count).toBe(2);
  });

  it("lembra o emocional apenas após uso no dia, depois das 18h e sem check-in", () => {
    const now = new Date("2026-08-06T22:00:00Z"); // 19h em São Paulo
    expect(emotionalReminderDue({ now, lastSurfaceSeenAt: "2026-08-06T20:00:00Z", checkinDates: [] }).due).toBe(true);
    expect(emotionalReminderDue({ now, lastSurfaceSeenAt: "2026-08-06T20:00:00Z", checkinDates: ["2026-08-06T19:00:00Z"] }).due).toBe(false);
    expect(emotionalReminderDue({ now: new Date("2026-08-06T19:00:00Z"), lastSurfaceSeenAt: "2026-08-06T18:00:00Z", checkinDates: [] }).due).toBe(false);
  });

  it("simula cartão com calendário completo e impacto integral na categoria", () => {
    const result = simulateSpending({
      amount: 300, installments: 3, method: "card", plannedDate: "2026-08-10",
      card: { id: "card", name: "Nino", closing_day: 20, due_day: 30 },
      categoryId: "leisure",
      snapshot: {
        availableToday: 1000,
        projection: { monthEnd: "2026-08-31", projectedEndBalance: 800, freeAfterKnownCommitments: 700, typicalDailyPace: 50, estimatedFixedInflows: 0, confidence: "high" },
        activeCategoryGoals: [{ goal: { category_id: "leisure", start_date: "2026-08-01", end_date: "2026-08-31" }, targetAmount: 500, actualSpend: 100, categoryName: "Lazer" }],
        goalProgress: [], commitmentAgenda: { items: [], hasEstimates: false },
        audit: { completeness: "complete" }, cardDebtIsEstimated: false, contractVersion: "financial_snapshot_contract.v8",
      } as never,
    });
    expect(result.installmentSchedule).toHaveLength(3);
    expect(result.installmentSchedule.map((item) => item.amount)).toEqual([100, 100, 100]);
    expect(result.categoryGoalImpact?.remainingAfter).toBe(100);
  });
});
