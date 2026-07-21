// Fase 3 — pure-logic tests for the intelligence layer.
// Following the same pattern as agent-core-phase2.test.ts: the pure
// helpers are mirrored here so vitest/tsgo can exercise them without
// pulling in Deno-only modules (esm.sh, SupabaseClient, etc).
import { describe, it, expect } from "vitest";

// ─────────────────────────── mirrored types ────────────────────────────
type UserProfile = {
  user_id: string;
  estimated_income: number | null;
  savings_capacity: number | null;
  net_worth: number | null;
  risk_level: "conservador" | "moderado" | "arrojado" | null;
  behavior_tags: string[];
  spending_pattern: Record<string, number>;
  seasonality: Record<string, number>;
  monthly_evolution: Array<{ month: string; income: number; expense: number; net: number }>;
  top_categories: Array<{ category: string; total: number; share: number }>;
  indicators: Record<string, number>;
  computed_at: string;
};

type InsightSeverity = "info" | "attention" | "critical";
type Insight = {
  id: string; kind: string; severity: InsightSeverity; score: number;
  title: string; body: string; evidence: Record<string, unknown>; dedup_key: string;
};

// ─────────────────────────── detectors (mirrors) ───────────────────────
function detectSpike(profile: UserProfile): Insight[] {
  const ev = profile.monthly_evolution;
  if (ev.length < 3) return [];
  const last = ev[ev.length - 1];
  const prevAvg = ev.slice(0, -1).reduce((s, m) => s + m.expense, 0) / (ev.length - 1);
  if (prevAvg <= 0 || last.expense <= prevAvg * 1.3) return [];
  const delta = (last.expense - prevAvg) / prevAvg;
  return [{
    id: "spike-" + last.month, kind: "spending_spike",
    severity: delta > 0.6 ? "critical" : "attention",
    score: Math.min(1, delta),
    title: `Gastos ${Math.round(delta * 100)}% acima da média`,
    body: "", evidence: { month: last.month, current: last.expense, avg: prevAvg },
    dedup_key: `spike:${last.month}`,
  }];
}
function detectConcentration(profile: UserProfile): Insight[] {
  const top = profile.top_categories?.[0];
  if (!top || top.share < 0.4) return [];
  return [{
    id: "conc-" + top.category, kind: "concentration_risk",
    severity: top.share > 0.55 ? "attention" : "info",
    score: top.share, title: `${top.category} concentra ${Math.round(top.share * 100)}% dos gastos`,
    body: "", evidence: { category: top.category, share: top.share },
    dedup_key: `conc:${top.category}`,
  }];
}
function detectDuplicates(txs: Array<{ id: string; amount: number; description?: string; occurred_at: string }>): Insight[] {
  const out: Insight[] = [];
  for (let i = 0; i < txs.length; i++) {
    for (let j = i + 1; j < txs.length; j++) {
      const a = txs[i], b = txs[j];
      const dt = Math.abs(+new Date(a.occurred_at) - +new Date(b.occurred_at));
      if (a.amount === b.amount && a.description === b.description && dt <= 24 * 3600 * 1000) {
        out.push({
          id: `dup-${a.id}-${b.id}`, kind: "duplicate_expense",
          severity: "attention", score: 0.7,
          title: "Possível duplicidade", body: "",
          evidence: { a: a.id, b: b.id, amount: a.amount },
          dedup_key: `dup:${a.id}:${b.id}`,
        });
      }
    }
  }
  return out;
}
function detectGoalRisk(goals: Array<{ id: string; name: string; target: number; current: number; deadline?: string | null }>): Insight[] {
  const out: Insight[] = [];
  for (const g of goals) {
    if (!g.deadline) continue;
    const monthsLeft = Math.max(0, Math.ceil((+new Date(g.deadline) - Date.now()) / (30 * 86400000)));
    const remaining = Math.max(0, g.target - g.current);
    if (monthsLeft <= 3 && remaining > g.target * 0.5) {
      out.push({
        id: "goal-" + g.id, kind: "goal_at_risk", severity: "attention", score: 0.8,
        title: `Meta "${g.name}" em risco`, body: "",
        evidence: { remaining, monthsLeft }, dedup_key: `goal:${g.id}`,
      });
    }
  }
  return out;
}
function detectForgottenBills(bills: Array<{ id: string; name: string; due_date: string; paid: boolean; amount: number }>): Insight[] {
  const today = new Date().toISOString().slice(0, 10);
  return bills.filter(b => !b.paid && b.due_date < today).map(b => ({
    id: "bill-" + b.id, kind: "forgotten_bill", severity: "critical", score: 0.9,
    title: `${b.name} venceu em ${b.due_date}`, body: "",
    evidence: { amount: b.amount }, dedup_key: `bill:${b.id}`,
  }));
}

const SEV_W: Record<InsightSeverity, number> = { info: 1, attention: 2, critical: 3 };
function rank(insights: Insight[], cooldowns: Set<string> = new Set()): Insight[] {
  return insights
    .filter(i => !cooldowns.has(i.dedup_key))
    .map(i => ({ ...i, _r: SEV_W[i.severity] * i.score }))
    .sort((a: any, b: any) => b._r - a._r)
    .map(({ _r, ...i }: any) => i);
}

// ─────────────────────────── planner (mirror) ──────────────────────────
type PlanObjective = { goal: string; target_amount: number; deadline_months?: number; monthly_contribution?: number; };
function buildPlan(profile: UserProfile, obj: PlanObjective) {
  const savings = Math.max(0, profile.savings_capacity ?? 0);
  let monthly = obj.monthly_contribution
    ?? (obj.deadline_months ? Math.ceil(obj.target_amount / obj.deadline_months) : Math.max(100, Math.floor(savings * 0.5)));
  const monthsNeeded = monthly > 0 ? Math.ceil(obj.target_amount / monthly) : 999;
  const feasibility =
    monthly <= savings * 0.7 ? "confortavel" :
    monthly <= savings * 1.1 ? "apertado" : "inviavel";
  const recs: string[] = [];
  if (feasibility === "inviavel") recs.push("Ajustar o valor da meta ou aumentar o prazo.");
  if (feasibility === "apertado") recs.push("Reveja assinaturas para liberar folga.");
  if (feasibility === "confortavel") recs.push("Automatize o aporte no dia do recebimento.");
  return { monthly_contribution: monthly, months_needed: monthsNeeded, feasibility, recommendations: recs };
}

// ─────────────────────────── personalization (mirror) ──────────────────
type Preferences = {
  tone: "friendly" | "neutral" | "formal";
  verbosity: "concise" | "balanced" | "detailed";
  explanation_style: "plain" | "technical" | "storytelling";
  example_style: "concrete" | "abstract";
  suggestion_frequency: "low" | "medium" | "high";
  technical_level: "basic" | "intermediate" | "advanced";
};
const DEFAULT_PREFS: Preferences = {
  tone: "friendly", verbosity: "balanced", explanation_style: "plain",
  example_style: "concrete", suggestion_frequency: "medium", technical_level: "basic",
};
function applyPreferencesToPrompt(base: string, p: Preferences): string {
  const tone = p.tone === "friendly" ? "acolhedor e humano" : p.tone === "formal" ? "formal" : "neutro";
  const verb = p.verbosity === "concise" ? "respostas curtas e diretas"
    : p.verbosity === "detailed" ? "explicações detalhadas" : "equilibrado entre curto e detalhado";
  return (base ?? "").trim() + `\n\nPersonalização do usuário:\n- Tom: ${tone}.\n- Verbosidade: ${verb}.`;
}

// ─────────────────────────── fixtures ──────────────────────────────────
function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    user_id: "u1", estimated_income: 5000, savings_capacity: 800, net_worth: 20000,
    risk_level: "moderado", behavior_tags: [], spending_pattern: {}, seasonality: {},
    monthly_evolution: [
      { month: "2026-05", income: 5000, expense: 3000, net: 2000 },
      { month: "2026-06", income: 5000, expense: 3050, net: 1950 },
      { month: "2026-07", income: 5000, expense: 5000, net: 0 },
    ],
    top_categories: [
      { category: "alimentacao", total: 2500, share: 0.5 },
      { category: "lazer", total: 1500, share: 0.3 },
    ],
    indicators: {}, computed_at: new Date().toISOString(), ...over,
  };
}

// ─────────────────────────── tests ─────────────────────────────────────
describe("Fase 3 · InsightsEngine (mirror)", () => {
  it("flags a spending spike above 30% of previous avg", () => {
    const r = detectSpike(profile());
    expect(r).toHaveLength(1);
    expect(["attention", "critical"]).toContain(r[0].severity);
  });

  it("ignores stable spending", () => {
    expect(detectSpike(profile({
      monthly_evolution: [
        { month: "05", income: 5000, expense: 3000, net: 2000 },
        { month: "06", income: 5000, expense: 3050, net: 1950 },
        { month: "07", income: 5000, expense: 3020, net: 1980 },
      ],
    }))).toEqual([]);
  });

  it("detects concentration when top category >=40%", () => {
    expect(detectConcentration(profile())).toHaveLength(1);
  });

  it("detects duplicate expenses within 24h", () => {
    const r = detectDuplicates([
      { id: "a", amount: 89.9, description: "iFood", occurred_at: "2026-07-18T20:00:00Z" },
      { id: "b", amount: 89.9, description: "iFood", occurred_at: "2026-07-18T20:30:00Z" },
    ]);
    expect(r).toHaveLength(1);
  });

  it("detects goals at risk near deadline", () => {
    const deadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const r = detectGoalRisk([{ id: "g1", name: "Viagem", target: 5000, current: 500, deadline }]);
    expect(r.some(i => i.kind === "goal_at_risk")).toBe(true);
  });

  it("detects forgotten bills past due", () => {
    const overdue = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const r = detectForgottenBills([{ id: "b1", name: "Luz", due_date: overdue, amount: 120, paid: false }]);
    expect(r).toHaveLength(1);
  });

  it("rank() removes cooldowns and prioritizes higher severity", () => {
    const insights: Insight[] = [
      { id: "1", kind: "spending_spike", severity: "critical", score: 0.9, title: "", body: "", evidence: {}, dedup_key: "a" },
      { id: "2", kind: "concentration_risk", severity: "info", score: 0.5, title: "", body: "", evidence: {}, dedup_key: "b" },
    ];
    const ranked = rank(insights, new Set(["a"]));
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe("2");
  });
});

describe("Fase 3 · FinancialPlanner (mirror)", () => {
  it("returns confortavel when contribution fits savings capacity", () => {
    const p = buildPlan(profile(), { goal: "Reserva", target_amount: 6000, deadline_months: 24 });
    expect(p.feasibility).toBe("confortavel");
  });
  it("returns inviavel when contribution exceeds savings by a lot", () => {
    const p = buildPlan(profile({ savings_capacity: 100 }), { goal: "Casa", target_amount: 20000, monthly_contribution: 2000 });
    expect(p.feasibility).toBe("inviavel");
    expect(p.recommendations.join(" ")).toMatch(/prazo|meta/i);
  });
});

describe("Fase 3 · PersonalizationEngine (mirror)", () => {
  it("appends a personalization block to the base prompt", () => {
    const out = applyPreferencesToPrompt("You are a financial assistant.", DEFAULT_PREFS);
    expect(out).toContain("You are a financial assistant.");
    expect(out).toContain("Personalização do usuário");
    expect(out).toContain("Tom");
  });
  it("produces different text for different preferences", () => {
    const a = applyPreferencesToPrompt("", { ...DEFAULT_PREFS, verbosity: "concise", tone: "formal" });
    const b = applyPreferencesToPrompt("", { ...DEFAULT_PREFS, verbosity: "detailed", tone: "friendly" });
    expect(a).not.toEqual(b);
    expect(a).toMatch(/curt|direta/i);
    expect(b).toMatch(/detalhad/i);
  });
});
