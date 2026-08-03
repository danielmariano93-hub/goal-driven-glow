// UserProfile — dynamic financial profile snapshot per user.
// Cached in user_profiles_snapshot with a TTL. All numbers are derived
// from real data (transactions, investments, debts, goals).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { behavioralMetricAmount, computeNetWorth, type TransactionRow } from "../../engine/facts.ts";

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

  const txFields = "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind";
  const [txResp, balanceTxResp, accResp, invResp, debtResp, categoryResp, snapResp] = await Promise.all([
    sb.from("transactions").select(txFields)
      .eq("user_id", user_id).gte("occurred_at", sixMonthsAgo.slice(0, 10)).limit(5000),
    sb.from("transactions").select(txFields)
      .eq("user_id", user_id).order("occurred_at", { ascending: true }).limit(10000),
    sb.from("accounts").select("id,name,type,opening_balance,active").eq("user_id", user_id),
    sb.from("investments").select("current_value").eq("user_id", user_id),
    sb.from("debts").select("outstanding_balance,status").eq("user_id", user_id),
    sb.from("categories").select("id,name").or(`user_id.eq.${user_id},user_id.is.null`),
    sb.from("account_balance_snapshots").select("*").eq("user_id", user_id),
  ]);


  const tx = ((txResp.data as any[] | null) ?? []).map(t => ({ ...t, amount: Number(t.amount || 0) }));
  const balanceTx = ((balanceTxResp.data as any[] | null) ?? []).map(t => ({ ...t, amount: Number(t.amount || 0) }));
  const categoryNames = new Map(((categoryResp.data as any[] | null) ?? []).map(c => [String(c.id), String(c.name)]));
  const byMonth = new Map<string, { income: number; expense: number }>();
  const byCat = new Map<string, number>();
  const bySeason = new Map<string, number>();

  for (const t of tx) {
    const income = behavioralMetricAmount(t as TransactionRow, "income");
    const expense = behavioralMetricAmount(t as TransactionRow, "expense");
    if (income === 0 && expense === 0) continue;
    const m = String(t.occurred_at ?? "").slice(0, 7);
    const rec = byMonth.get(m) ?? { income: 0, expense: 0 };
    rec.income += income;
    rec.expense += expense;
    byMonth.set(m, rec);
    if (expense > 0 && t.category_id) {
      const category = categoryNames.get(String(t.category_id)) ?? "Sem categoria";
      byCat.set(category, (byCat.get(category) ?? 0) + expense);
    }
    if (expense > 0) {
      const season = seasonLabel(new Date(`${String(t.occurred_at).slice(0, 10)}T12:00:00Z`));
      bySeason.set(season, (bySeason.get(season) ?? 0) + expense);
    }
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

  const accounts = ((accResp.data as any[] | null) ?? []).map(a => ({
    ...a, opening_balance: Number(a.opening_balance || 0), active: a.active !== false,
  }));
  const balances = computeAccountBalances(accounts as any, balanceTx as TransactionRow[]);
  const netWorth =
    (Object.values(balances) as number[]).reduce((sum, value) => sum + Number(value || 0), 0) +
    ((invResp.data as any[] | null) ?? []).reduce((sum, i) => sum + Number(i.current_value || 0), 0) -
    ((debtResp.data as any[] | null) ?? []).reduce((sum, d) => sum + Number(d.outstanding_balance || 0), 0);

  const tags: string[] = [];
  if (savings > incomeAvg * 0.2) tags.push("poupador");
  if (savings < 0) tags.push("deficit");
  if (top_categories[0]?.share > 0.4) tags.push("concentrado");
  if (monthly_evolution.length >= 3 && trend(monthly_evolution.map(m => m.expense)) > 0.1) tags.push("gasto_crescente");

  // Capacidade de poupança não mede tolerância a risco. Até existir um
  // questionário explícito, o Nino não deve inventar perfil de investidor.
  const risk: UserProfile["risk_level"] = null;

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
