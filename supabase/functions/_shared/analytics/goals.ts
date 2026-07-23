// project_goal_completion + simulate_goal_pace — projeta data de conclusão e
// simula cenários. Ritmo observado = média móvel de 3 meses de contribuições.
import { makeProvenance, type Provenance, type Confidence } from "./provenance.ts";
import { todaySP } from "./periods.ts";

export type GoalInput = {
  goal: { id: string; name: string; target_amount: number; target_date: string | null; status?: string };
  contributions: Array<{ amount: number; occurred_at: string }>;
  today?: string;
};

export type GoalProjection = {
  goal_id: string;
  name: string;
  current: number;
  target: number;
  remaining: number;
  required_pace_month: number | null;
  observed_pace_month: number;
  projected_date: string | null;
  days_ahead_or_late: number | null;
  scenarios_default: Array<{ monthly: number; projected_date: string }>;
  provenance: Provenance;
};

export const FORMULA_VERSION = "goal.project.v1";

export function projectGoal(input: GoalInput): GoalProjection {
  const today = input.today ?? todaySP();
  const current = input.contributions.reduce((s, c) => s + Number(c.amount || 0), 0);
  const target = Number(input.goal.target_amount || 0);
  const remaining = Math.max(0, target - current);

  // observed pace: soma de contribuições nos últimos 90 dias / 3
  const threeMonthsAgo = shift(today, -90);
  const recent = input.contributions.filter(c => c.occurred_at.slice(0, 10) >= threeMonthsAgo);
  const observedTotal = recent.reduce((s, c) => s + Number(c.amount || 0), 0);
  const observed_pace_month = observedTotal / 3;

  // required pace
  let required_pace_month: number | null = null;
  if (input.goal.target_date) {
    const monthsToTarget = monthsBetween(today, input.goal.target_date);
    required_pace_month = monthsToTarget > 0 ? remaining / monthsToTarget : null;
  }

  // projected date
  let projected_date: string | null = null;
  let days_ahead_or_late: number | null = null;
  if (observed_pace_month > 0.5 && remaining > 0) {
    const months = remaining / observed_pace_month;
    projected_date = addMonths(today, months);
    if (input.goal.target_date) {
      days_ahead_or_late = daysBetween(input.goal.target_date, projected_date);
    }
  }

  // scenarios default: 3 valores próximos ao required
  const base = required_pace_month ?? observed_pace_month ?? 100;
  const scenarios_default = [0.5, 1, 1.5].map(mult => {
    const monthly = Math.round(base * mult);
    const months = monthly > 0 ? remaining / monthly : 999;
    return { monthly, projected_date: addMonths(today, months) };
  });

  const confidence: Confidence = recent.length < 3
    ? "insufficient_data"
    : recent.length < 6 ? "low"
    : recent.length < 12 ? "medium" : "high";

  return {
    goal_id: input.goal.id,
    name: input.goal.name,
    current: round2(current),
    target: round2(target),
    remaining: round2(remaining),
    required_pace_month: required_pace_month === null ? null : round2(required_pace_month),
    observed_pace_month: round2(observed_pace_month),
    projected_date,
    days_ahead_or_late,
    scenarios_default,
    provenance: makeProvenance({
      from: threeMonthsAgo, to: today,
      row_count: recent.length,
      formula_version: FORMULA_VERSION,
      confidence,
      notes: confidence === "insufficient_data" ? ["Poucos aportes; projeção ainda instável."] : undefined,
    }),
  };
}

export function simulatePace(input: GoalInput, monthlyContribution: number): { projected_date: string; months: number } {
  const today = input.today ?? todaySP();
  const current = input.contributions.reduce((s, c) => s + Number(c.amount || 0), 0);
  const remaining = Math.max(0, Number(input.goal.target_amount || 0) - current);
  const months = monthlyContribution > 0 ? remaining / monthlyContribution : 999;
  return { projected_date: addMonths(today, months), months: round2(months) };
}

function shift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() >= a.getUTCDate() ? 0 : -1) + 1;
}
function addMonths(ymd: string, months: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const totalDays = Math.round(months * 30.44);
  d.setUTCDate(d.getUTCDate() + totalDays);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T12:00:00Z`).getTime();
  const db = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((db - da) / 86400000);
}
function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
