import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildObservedProfileV2, OBSERVED_METHODOLOGY_VERSION } from "@/lib/behavioral/observedProfileV2";
import type { EmotionalCheckinRow } from "@/lib/behavioral/client";

const migration = readFileSync("supabase/migrations/20260920145622_behavior_observed_v2.sql", "utf8");
const dashboard = readFileSync("src/lib/behavioral/dashboardSnapshot.ts", "utf8");
const page = readFileSync("src/pages/Emocoes.tsx", "utf8");
const wheel = readFileSync("src/components/behavioral/BehaviorWheel.tsx", "utf8");
const insights = readFileSync("src/components/emotions/BehavioralInsightsCard.tsx", "utf8");
const usage = readFileSync("src/components/behavioral/BehavioralUsageTracker.tsx", "utf8");

function financialRow(overrides: Record<string, unknown> = {}) {
  return {
    as_of_date: "2026-09-20",
    available_balance: 1200,
    payload: {
      snapshot: {
        monthlyTotals: { income: 10000, expense: 4000 },
        averageDailyVariationPct: -25,
        activeCategoryGoals: [
          { status: "on_track" },
          { status: "on_track" },
        ],
        projection: { freeAfterKnownCommitments: 3000, projectedEndBalance: 2500 },
        netWorth: { assets: 25000, owed: 10000, net: 15000 },
        netWorthBridge: { openingDebts: 12000, closingDebts: 10000 },
        periodPerformance: { savingsRate: 0.3 },
        rhythm: { current: { series: [100, 110, 90, 100, 95, 105, 98].map((typicalAmount, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, typicalAmount })) } },
        ...overrides,
      },
    },
  };
}

function legacyCheckins(n: number): EmotionalCheckinRow[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `legacy-${index}`,
    occurred_at: new Date(Date.now() - index * 86_400_000).toISOString(),
    mood: 3,
    financial_calm_score: null,
    financial_control_score: null,
    spending_urge_score: null,
  }));
}

const baseInput = {
  financialRow: financialRow(),
  checkins: legacyCheckins(8),
  txStats: { count: 100, categorized: 100, active_days: 25, first_at: new Date(Date.now() - 10 * 86_400_000).toISOString() },
  appActivity: { active_days_30: 0, total_views_30: 0, financial_views_30: 0, movement_views_30: 0, planning_views_30: 0 },
  goalCycles: [],
  planningStats: { active_category_goals: 2, active_recurring_rules: 0 },
  investmentStats: { current_value: 25000, emergency_reserve_value: 0, contributions_90d: 0, contribution_days_90d: 0 },
};

describe("behavior_observed.v2", () => {
  it("starts scoring early but caps awareness while first-party app activity is not yet observed", () => {
    const profile = buildObservedProfileV2(baseInput);
    expect(OBSERVED_METHODOLOGY_VERSION).toBe("behavior_observed.v2");
    expect(profile.dimensions.awareness.score).not.toBeNull();
    expect(profile.dimensions.awareness.score!).toBeLessThanOrEqual(6.5);
  });

  it("does not treat an on-track current goal as proven control before a cycle closes", () => {
    const profile = buildObservedProfileV2({
      ...baseInput,
      financialRow: financialRow({ averageDailyVariationPct: -100, activeCategoryGoals: [{ status: "on_track" }, { status: "on_track" }] }),
    });
    expect(profile.dimensions.control.score).not.toBeNull();
    expect(profile.dimensions.control.score!).toBeLessThanOrEqual(7);
    expect(profile.dimensions.control.confidence).not.toBe("high");
  });

  it("does not call one strong savings month a recurring wealth-building habit", () => {
    const profile = buildObservedProfileV2({
      ...baseInput,
      investmentStats: { current_value: 50000, emergency_reserve_value: 0, contributions_90d: 0, contribution_days_90d: 0 },
      financialRow: financialRow({ periodPerformance: { savingsRate: 0.4 }, netWorth: { assets: 80000, owed: 0, net: 80000 } }),
    });
    expect(profile.dimensions.wealth.score).not.toBeNull();
    expect(profile.dimensions.wealth.score!).toBeLessThanOrEqual(6);
    expect(profile.dimensions.wealth.confidence).toBe("low");
  });

  it("keeps legacy mood useful but low-confidence until direct financial-calm samples accumulate", () => {
    const profile = buildObservedProfileV2(baseInput);
    expect(profile.dimensions.calm.score).toBe(6);
    expect(profile.dimensions.calm.confidence).toBe("low");
    expect(profile.dimensions.calm.evidence).toContain("contexto estimado");
  });

  it("raises security evidence only when liquid emergency reserve is explicitly available", () => {
    const withoutReserve = buildObservedProfileV2(baseInput);
    const withReserve = buildObservedProfileV2({
      ...baseInput,
      investmentStats: { current_value: 25000, emergency_reserve_value: 24000, contributions_90d: 0, contribution_days_90d: 0 },
    });
    expect(withReserve.dimensions.security.score!).toBeGreaterThan(withoutReserve.dimensions.security.score!);
    expect(withReserve.dimensions.security.evidence).toContain("investimentos marcados como reserva");
  });

  it("tracks only coarse app surfaces and never content or query strings", () => {
    expect(migration).toContain("behavioral_app_activity_daily");
    expect(migration).toContain("behavioral_record_app_activity");
    expect(migration).toContain("using ((select auth.uid()) = user_id)");
    expect(usage).toContain("surfaceForPath");
    expect(usage).not.toContain("location.search");
    expect(usage).not.toContain("document.title");
  });

  it("uses explicit reserve classification instead of assuming every investment is emergency cash", () => {
    expect(migration).toContain("reserve_role");
    expect(migration).toContain("emergency_reserve");
    expect(migration).toContain("where user_id=v_uid and reserve_role='emergency_reserve'");
  });

  it("excludes accounting-only movements from observed spending statistics", () => {
    const transactionStatsSection = migration.split("'transaction_stats'")[1]?.split("'expense_days'")[0] ?? "";
    expect(transactionStatsSection).toContain("coalesce(movement_kind::text,'transaction') = 'transaction'");
  });

  it("restores real emotion-spend pairing in the canonical dashboard", () => {
    expect(migration).toContain("'expense_days'");
    expect(dashboard).toContain("computeEmotionSpend");
    expect(dashboard).toContain("pairedDays: paired.length");
    expect(dashboard).not.toContain("pairedDays: 0,\n      vulnerableDays: 0");
  });

  it("does not present a relative 5/10 high as a consolidated strength", () => {
    expect(page).toContain("ainda não significa um ponto forte consolidado");
    expect(wheel).toContain("Sua maior nota hoje");
    expect(wheel).toContain("não um ponto forte consolidado");
  });

  it("labels heuristic hypothesis confidence as evidence strength, not probability", () => {
    expect(insights).toContain("A força abaixo não é probabilidade");
    expect(insights).toContain("Evidência moderada");
    expect(insights).not.toContain("Math.round(Number(item.confidence) * 100)");
  });
});
