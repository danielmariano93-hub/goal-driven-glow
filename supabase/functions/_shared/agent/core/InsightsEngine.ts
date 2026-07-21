// InsightsEngine — pure, testable detectors + priority ranking.
// Each detector receives (profile, ctx) and returns Insight[]. `rank()`
// prioritises by severity * score * recency and applies cooldown via memory.
// deno-lint-ignore-file no-explicit-any
import type { UserProfile } from "./UserProfile.ts";

export type InsightSeverity = "info" | "attention" | "critical";
export type InsightKind =
  | "spending_spike" | "duplicate_expense" | "underused_subscription"
  | "above_average" | "growing_category" | "saving_opportunity"
  | "goal_at_risk" | "forgotten_bill" | "investment_opportunity"
  | "concentration_risk";

export type Insight = {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  score: number;
  title: string;
  body: string;
  action?: { type: string; payload?: Record<string, unknown> };
  evidence: Record<string, unknown>;
  dedup_key: string;
};

export type DetectorCtx = {
  transactions?: Array<{ id: string; amount: number; description?: string; category_id?: string; occurred_at: string; type: string; movement_kind?: string }>;
  subscriptions?: Array<{ id: string; description: string; last_used?: string | null; amount: number }>;
  goals?: Array<{ id: string; name: string; target: number; current: number; deadline?: string | null }>;
  bills?: Array<{ id: string; name: string; due_date: string; amount: number; paid: boolean }>;
  cooldowns?: Set<string>;
};

const SEV_WEIGHT: Record<InsightSeverity, number> = { info: 1, attention: 2, critical: 3 };

export function detectSpike(profile: UserProfile): Insight[] {
  const ev = profile.monthly_evolution;
  if (ev.length < 3) return [];
  const last = ev[ev.length - 1];
  const prevAvg = ev.slice(0, -1).reduce((s, m) => s + m.expense, 0) / (ev.length - 1);
  if (prevAvg <= 0 || last.expense <= prevAvg * 1.3) return [];
  const delta = ((last.expense - prevAvg) / prevAvg);
  return [{
    id: "spike-" + last.month, kind: "spending_spike",
    severity: delta > 0.6 ? "critical" : "attention",
    score: Math.min(1, delta),
    title: `Gastos ${Math.round(delta * 100)}% acima da média em ${last.month}`,
    body: `Você gastou R$ ${last.expense.toFixed(2)}, contra média de R$ ${prevAvg.toFixed(2)}.`,
    evidence: { month: last.month, current: last.expense, avg: prevAvg },
    dedup_key: `spike:${last.month}`,
  }];
}

export function detectConcentration(profile: UserProfile): Insight[] {
  const top = profile.top_categories[0];
  if (!top || top.share < 0.4) return [];
  return [{
    id: "conc-" + top.category, kind: "concentration_risk",
    severity: top.share > 0.6 ? "critical" : "attention",
    score: top.share,
    title: `${Math.round(top.share * 100)}% dos gastos em uma única categoria`,
    body: "Diversificar as despesas ajuda a identificar cortes e reduz risco financeiro.",
    evidence: { category: top.category, share: top.share, total: top.total },
    dedup_key: `conc:${top.category}`,
  }];
}

export function detectGrowingCategory(profile: UserProfile): Insight[] {
  const cats = profile.top_categories;
  if (cats.length === 0 || profile.monthly_evolution.length < 3) return [];
  const results: Insight[] = [];
  const totalTrend = profile.indicators.savings_rate < 0 ? 1 : 0;
  if (totalTrend) {
    results.push({
      id: "grow-overall", kind: "growing_category",
      severity: "attention", score: 0.7,
      title: "Suas despesas superam a renda",
      body: "Nos últimos meses você gastou mais do que ganhou. Vale rever categorias mais pesadas.",
      evidence: { savings_rate: profile.indicators.savings_rate },
      dedup_key: "grow:overall",
    });
  }
  return results;
}

export function detectDuplicates(ctx: DetectorCtx): Insight[] {
  const tx = ctx.transactions ?? [];
  const map = new Map<string, typeof tx>();
  for (const t of tx) {
    if (t.type !== "expense") continue;
    const key = `${(t.description ?? "").toLowerCase().slice(0, 30)}::${Math.round(t.amount)}::${t.occurred_at.slice(0, 10)}`;
    (map.get(key) ?? map.set(key, []).get(key)!).push(t);
  }
  const dups: Insight[] = [];
  for (const [key, list] of map) {
    if (list.length < 2) continue;
    dups.push({
      id: "dup-" + key, kind: "duplicate_expense",
      severity: "attention", score: Math.min(1, 0.5 + list.length * 0.1),
      title: `Possível duplicidade: ${list[0].description ?? "gasto"}`,
      body: `Registrei ${list.length} lançamentos idênticos no mesmo dia. Confira se é um erro.`,
      evidence: { count: list.length, description: list[0].description, amount: list[0].amount },
      dedup_key: `dup:${key}`,
    });
  }
  return dups;
}

export function detectGoalRisk(ctx: DetectorCtx): Insight[] {
  const goals = ctx.goals ?? [];
  const now = Date.now();
  const results: Insight[] = [];
  for (const g of goals) {
    if (!g.deadline) continue;
    const remaining = g.target - g.current;
    if (remaining <= 0) continue;
    const daysLeft = Math.max(1, Math.floor((new Date(g.deadline).getTime() - now) / 86400000));
    const monthlyNeeded = remaining / (daysLeft / 30);
    results.push({
      id: "goal-" + g.id, kind: "goal_at_risk",
      severity: daysLeft < 30 ? "critical" : "attention",
      score: Math.min(1, 1 - g.current / Math.max(1, g.target)),
      title: `Meta "${g.name}" precisa de R$ ${monthlyNeeded.toFixed(0)}/mês`,
      body: `Faltam R$ ${remaining.toFixed(2)} em ${daysLeft} dias para bater essa meta.`,
      evidence: { remaining, days_left: daysLeft, monthly_needed: monthlyNeeded },
      dedup_key: `goal:${g.id}`,
    });
  }
  return results;
}

export function detectForgottenBills(ctx: DetectorCtx): Insight[] {
  const bills = ctx.bills ?? [];
  const now = Date.now();
  const results: Insight[] = [];
  for (const b of bills) {
    if (b.paid) continue;
    const due = new Date(b.due_date).getTime();
    const daysUntil = Math.floor((due - now) / 86400000);
    if (daysUntil > 5 || daysUntil < -3) continue;
    results.push({
      id: "bill-" + b.id, kind: "forgotten_bill",
      severity: daysUntil < 0 ? "critical" : daysUntil <= 2 ? "attention" : "info",
      score: 0.6,
      title: daysUntil < 0 ? `${b.name} venceu há ${-daysUntil} dia(s)` : `${b.name} vence em ${daysUntil} dia(s)`,
      body: `Valor: R$ ${b.amount.toFixed(2)}.`,
      evidence: { due: b.due_date, amount: b.amount },
      dedup_key: `bill:${b.id}`,
    });
  }
  return results;
}

export function detectUnderusedSubscription(ctx: DetectorCtx): Insight[] {
  const subs = ctx.subscriptions ?? [];
  const results: Insight[] = [];
  for (const s of subs) {
    if (!s.last_used) continue;
    const daysSince = Math.floor((Date.now() - new Date(s.last_used).getTime()) / 86400000);
    if (daysSince < 60) continue;
    results.push({
      id: "sub-" + s.id, kind: "underused_subscription",
      severity: "attention", score: Math.min(1, daysSince / 180),
      title: `${s.description} pouco usada há ${daysSince} dias`,
      body: `Você paga R$ ${s.amount.toFixed(2)}/mês. Vale cancelar?`,
      evidence: { days_since: daysSince, amount: s.amount },
      dedup_key: `sub:${s.id}`,
    });
  }
  return results;
}

export function detectSavingOpportunity(profile: UserProfile): Insight[] {
  const rate = profile.indicators.savings_rate ?? 0;
  if (rate <= 0.3 || (profile.savings_capacity ?? 0) < 500) return [];
  return [{
    id: "save-opportunity", kind: "saving_opportunity",
    severity: "info", score: 0.5,
    title: "Você tem folga para investir",
    body: `Sobra estimada de R$ ${profile.savings_capacity?.toFixed(2)} por mês. Que tal automatizar um aporte?`,
    evidence: { savings: profile.savings_capacity, rate },
    dedup_key: "save:opportunity",
  }];
}

export function runAllDetectors(profile: UserProfile, ctx: DetectorCtx = {}): Insight[] {
  return [
    ...detectSpike(profile),
    ...detectConcentration(profile),
    ...detectGrowingCategory(profile),
    ...detectDuplicates(ctx),
    ...detectGoalRisk(ctx),
    ...detectForgottenBills(ctx),
    ...detectUnderusedSubscription(ctx),
    ...detectSavingOpportunity(profile),
  ];
}

export function rank(insights: Insight[], ctx: DetectorCtx = {}): Insight[] {
  const cd = ctx.cooldowns ?? new Set<string>();
  return insights
    .filter(i => !cd.has(i.dedup_key))
    .map(i => ({ ...i, _rank: SEV_WEIGHT[i.severity] * i.score }))
    .sort((a: any, b: any) => b._rank - a._rank)
    .map(({ _rank, ...i }: any) => i);
}
