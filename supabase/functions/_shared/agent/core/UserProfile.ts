// UserProfile — dynamic financial profile snapshot per user.
// Cached in user_profiles_snapshot with a TTL. All numbers are derived
// from real data (transactions, investments, debts, goals).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type UserProfile = {
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

const TTL_MS = 6 * 60 * 60 * 1000;

export async function loadProfile(sb: SupabaseClient, user_id: string, opts: { force?: boolean } = {}): Promise<UserProfile> {
  if (!opts.force) {
    const { data } = await sb.from("user_profiles_snapshot").select("*").eq("user_id", user_id).maybeSingle();
    if (data && Date.now() - new Date((data as any).computed_at).getTime() < TTL_MS) {
      return data as UserProfile;
    }
  }
  return await recomputeProfile(sb, user_id);
}

export async function recomputeProfile(sb: SupabaseClient, user_id: string): Promise<UserProfile> {
  const profile = await computeProfile(sb, user_id);
  await sb.from("user_profiles_snapshot").upsert(profile, { onConflict: "user_id" });
  return profile;
}

export async function computeProfile(sb: SupabaseClient, user_id: string): Promise<UserProfile> {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

  const [txResp, accResp, invResp, debtResp] = await Promise.all([
    sb.from("transactions").select("amount, type, category_id, occurred_at, movement_kind")
      .eq("user_id", user_id).gte("occurred_at", sixMonthsAgo).limit(5000),
    sb.from("accounts").select("id, current_balance, type").eq("user_id", user_id),
    sb.from("investments").select("current_amount").eq("user_id", user_id),
    sb.from("debts").select("remaining_amount").eq("user_id", user_id),
  ]);

  const tx = (txResp.data as any[] | null) ?? [];
  const byMonth = new Map<string, { income: number; expense: number }>();
  const byCat = new Map<string, number>();
  const bySeason = new Map<string, number>();

  const behavioral = tx.filter(t => !["transfer", "investment_apply", "investment_redeem", "card_payment"].includes(t.movement_kind ?? ""));

  for (const t of behavioral) {
    const m = String(t.occurred_at ?? "").slice(0, 7);
    const rec = byMonth.get(m) ?? { income: 0, expense: 0 };
    const amt = Math.abs(Number(t.amount) || 0);
    if (t.type === "income") rec.income += amt;
    else if (t.type === "expense") rec.expense += amt;
    byMonth.set(m, rec);
    if (t.type === "expense" && t.category_id) {
      byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + amt);
    }
    const season = seasonLabel(new Date(t.occurred_at));
    if (t.type === "expense") bySeason.set(season, (bySeason.get(season) ?? 0) + amt);
  }

  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  const monthly_evolution = months.map(([month, v]) => ({
    month, income: round(v.income), expense: round(v.expense), net: round(v.income - v.expense),
  }));

  const totalExpense = [...byCat.values()].reduce((a, b) => a + b, 0);
  const top_categories = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([category, total]) => ({ category, total: round(total), share: totalExpense ? round(total / totalExpense, 3) : 0 }));

  const incomeAvg = avg(monthly_evolution.map(m => m.income));
  const expenseAvg = avg(monthly_evolution.map(m => m.expense));
  const savings = incomeAvg - expenseAvg;

  const netWorth =
    ((accResp.data as any[] | null) ?? []).reduce((s, a) => s + Number(a.current_balance || 0), 0) +
    ((invResp.data as any[] | null) ?? []).reduce((s, i) => s + Number(i.current_amount || 0), 0) -
    ((debtResp.data as any[] | null) ?? []).reduce((s, d) => s + Number(d.remaining_amount || 0), 0);

  const tags: string[] = [];
  if (savings > incomeAvg * 0.2) tags.push("poupador");
  if (savings < 0) tags.push("deficit");
  if (top_categories[0]?.share > 0.4) tags.push("concentrado");
  if (monthly_evolution.length >= 3 && trend(monthly_evolution.map(m => m.expense)) > 0.1) tags.push("gasto_crescente");

  const risk: UserProfile["risk_level"] =
    savings > incomeAvg * 0.25 ? "arrojado" :
    savings > 0 ? "moderado" : "conservador";

  return {
    user_id,
    estimated_income: round(incomeAvg),
    savings_capacity: round(savings),
    net_worth: round(netWorth),
    risk_level: risk,
    behavior_tags: tags,
    spending_pattern: Object.fromEntries([...byCat.entries()].map(([k, v]) => [k, round(v)])),
    seasonality: Object.fromEntries([...bySeason.entries()].map(([k, v]) => [k, round(v)])),
    monthly_evolution,
    top_categories,
    indicators: {
      income_avg: round(incomeAvg),
      expense_avg: round(expenseAvg),
      savings_rate: incomeAvg > 0 ? round(savings / incomeAvg, 3) : 0,
      concentration_top1: top_categories[0]?.share ?? 0,
      months_observed: monthly_evolution.length,
    },
    computed_at: new Date().toISOString(),
  };
}

function round(n: number, digits = 2): number { const p = 10 ** digits; return Math.round(n * p) / p; }
function avg(a: number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function trend(a: number[]): number {
  if (a.length < 2) return 0;
  const first = avg(a.slice(0, Math.floor(a.length / 2)));
  const last = avg(a.slice(Math.floor(a.length / 2)));
  return first > 0 ? (last - first) / first : 0;
}
function seasonLabel(d: Date): string {
  const m = d.getMonth() + 1;
  if ([12, 1, 2].includes(m)) return "verao";
  if ([3, 4, 5].includes(m)) return "outono";
  if ([6, 7, 8].includes(m)) return "inverno";
  return "primavera";
}
