// Fase 3 — pure-module tests for the intelligence layer.
// No DB, no supabase. Verifies InsightsEngine detectors, ranking with
// cooldowns, FinancialPlanner feasibility, and PersonalizationEngine
// prompt composition.
import { describe, it, expect } from "vitest";
import {
  detectSpike, detectConcentration, detectDuplicates, detectGoalRisk,
  detectForgottenBills, runAllDetectors, rank,
} from "../../supabase/functions/_shared/agent/core/InsightsEngine.ts";
import { buildPlan } from "../../supabase/functions/_shared/agent/core/FinancialPlanner.ts";
import {
  applyPreferencesToPrompt, DEFAULT_PREFS,
} from "../../supabase/functions/_shared/agent/core/PersonalizationEngine.ts";

function baseProfile(overrides: any = {}) {
  return {
    user_id: "u1",
    estimated_income: 5000,
    savings_capacity: 800,
    net_worth: 20000,
    risk_level: "moderado" as const,
    behavior_tags: [],
    spending_pattern: {},
    seasonality: {},
    monthly_evolution: [
      { month: "2026-04", income: 5000, expense: 3000, net: 2000 },
      { month: "2026-05", income: 5000, expense: 3100, net: 1900 },
      { month: "2026-06", income: 5000, expense: 3050, net: 1950 },
      { month: "2026-07", income: 5000, expense: 5000, net: 0 },
    ],
    top_categories: [
      { category: "alimentacao", total: 2500, share: 0.5 },
      { category: "lazer", total: 1500, share: 0.3 },
    ],
    indicators: {},
    computed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("InsightsEngine", () => {
  it("detects a spending spike over 30% of previous average", () => {
    const insights = detectSpike(baseProfile());
    expect(insights).toHaveLength(1);
    expect(insights[0].kind).toBe("spending_spike");
    expect(insights[0].severity === "critical" || insights[0].severity === "attention").toBe(true);
  });

  it("returns no spike for stable spending", () => {
    const flat = baseProfile({
      monthly_evolution: [
        { month: "2026-05", income: 5000, expense: 3000, net: 2000 },
        { month: "2026-06", income: 5000, expense: 3050, net: 1950 },
        { month: "2026-07", income: 5000, expense: 3020, net: 1980 },
      ],
    });
    expect(detectSpike(flat)).toEqual([]);
  });

  it("flags concentration when a category exceeds 40% of expenses", () => {
    const insights = detectConcentration(baseProfile());
    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0].kind).toBe("concentration_risk");
  });

  it("detects duplicate expenses with same amount within 24h", () => {
    const insights = detectDuplicates({
      transactions: [
        { id: "a", amount: 89.9, description: "iFood", occurred_at: "2026-07-18T20:00:00Z", type: "expense" },
        { id: "b", amount: 89.9, description: "iFood", occurred_at: "2026-07-18T20:30:00Z", type: "expense" },
      ],
    });
    expect(insights).toHaveLength(1);
    expect(insights[0].kind).toBe("duplicate_expense");
  });

  it("detects goals at risk close to the deadline", () => {
    const deadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const insights = detectGoalRisk({
      goals: [{ id: "g1", name: "Viagem", target: 5000, current: 500, deadline }],
    });
    expect(insights.some(i => i.kind === "goal_at_risk")).toBe(true);
  });

  it("detects forgotten bills already past due", () => {
    const insights = detectForgottenBills({
      bills: [
        { id: "b1", name: "Luz", due_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10), amount: 120, paid: false },
      ],
    });
    expect(insights.some(i => i.kind === "forgotten_bill")).toBe(true);
  });

  it("rank() respects cooldowns and severity ordering", () => {
    const all = runAllDetectors(baseProfile());
    const cd = new Set(all.filter(i => i.kind === "spending_spike").map(i => i.dedup_key));
    const ranked = rank(all, { cooldowns: cd });
    expect(ranked.every(i => i.kind !== "spending_spike")).toBe(true);
    for (let i = 1; i < ranked.length; i++) {
      // higher-priority always come first — severity dominates ordering
      const w = (s: string) => s === "critical" ? 3 : s === "attention" ? 2 : 1;
      expect(w(ranked[i - 1].severity) * ranked[i - 1].score)
        .toBeGreaterThanOrEqual(w(ranked[i].severity) * ranked[i].score - 1e-9);
    }
  });
});

describe("FinancialPlanner", () => {
  it("classifies a plan as confortavel when within savings capacity", () => {
    const plan = buildPlan(baseProfile(), { goal: "Reserva", target_amount: 6000, deadline_months: 24 });
    expect(plan.months_needed).toBeLessThanOrEqual(24);
    expect(plan.feasibility).toBe("confortavel");
    expect(plan.milestones.length).toBeGreaterThan(0);
  });

  it("classifies a plan as inviavel when it exceeds savings by a lot", () => {
    const plan = buildPlan(baseProfile({ savings_capacity: 100 }),
      { goal: "Casa", target_amount: 20000, monthly_contribution: 2000 });
    expect(plan.feasibility).toBe("inviavel");
    expect(plan.recommendations.join(" ")).toMatch(/prazo|meta/i);
  });
});

describe("PersonalizationEngine", () => {
  it("appends personalization block to the base prompt", () => {
    const out = applyPreferencesToPrompt("You are a financial assistant.", DEFAULT_PREFS);
    expect(out).toContain("You are a financial assistant.");
    expect(out).toContain("Personalização do usuário");
    expect(out).toContain("Tom");
    expect(out).toContain("Verbosidade");
  });

  it("changes wording when preferences change", () => {
    const a = applyPreferencesToPrompt("", { ...DEFAULT_PREFS, verbosity: "concise", tone: "formal" });
    const b = applyPreferencesToPrompt("", { ...DEFAULT_PREFS, verbosity: "detailed", tone: "friendly" });
    expect(a).not.toEqual(b);
    expect(a).toMatch(/curt|direta/i);
    expect(b).toMatch(/detalhad/i);
  });
});
