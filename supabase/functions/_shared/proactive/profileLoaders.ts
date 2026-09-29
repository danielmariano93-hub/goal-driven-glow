// deno-lint-ignore-file no-explicit-any
// Leituras do perfil do usuário para o motor proativo: qualidade do dado e
// modelo do usuário. Só LEEM; todo cálculo fica nas funções puras de
// `dataQuality.ts` e `userModel.ts`.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computeMonthlyTotals, type TransactionRow } from "../finance-core/facts.ts";
import { assessDataQuality, type DataQuality } from "./dataQuality.ts";
import { buildUserModel, type UserModel } from "./userModel.ts";
import type { RecentDelivery } from "./repetition.ts";

function ymShift(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function loadDataQuality(
  sb: SupabaseClient,
  userId: string,
  facts: { today: string; current_month_income: number; expected_income_rest_of_month: number },
): Promise<DataQuality> {
  const ym = facts.today.slice(0, 7);
  const fromYm = ymShift(ym, -3);
  const [incomeRes, firstRes, lastRes] = await Promise.all([
    sb.from("transactions")
      .select("id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,competence_date,settles_card_id,movement_kind")
      .eq("user_id", userId).eq("status", "confirmed").eq("type", "income")
      .gte("occurred_at", `${fromYm}-01`).lt("occurred_at", `${ym}-01`)
      .limit(1000),
    sb.from("transactions").select("occurred_at").eq("user_id", userId).eq("status", "confirmed")
      .order("occurred_at", { ascending: true }).limit(1),
    sb.from("transactions").select("occurred_at").eq("user_id", userId).eq("status", "confirmed")
      .lte("occurred_at", facts.today)
      .order("occurred_at", { ascending: false }).limit(1),
  ]);
  const rows = ((incomeRes as any)?.data ?? []) as TransactionRow[];
  const previous = [1, 2, 3].map((back) => computeMonthlyTotals(rows, ymShift(ym, -back)).income);
  return assessDataQuality({
    today: facts.today,
    current_month_income: facts.current_month_income,
    expected_income_rest_of_month: facts.expected_income_rest_of_month,
    previous_months_income: previous,
    first_entry_date: ((firstRes as any)?.data?.[0]?.occurred_at ?? null) as string | null,
    last_entry_date: ((lastRes as any)?.data?.[0]?.occurred_at ?? null) as string | null,
  });
}

export async function loadUserModel(sb: SupabaseClient, userId: string, today: string): Promise<UserModel> {
  const [goalsRes, contribRes, memoryRes] = await Promise.all([
    sb.from("goals").select("id,name,target_amount,target_date,monthly_target,kind,status")
      .eq("user_id", userId).eq("status", "active").limit(20),
    sb.from("goal_contributions").select("goal_id,amount").eq("user_id", userId).limit(1000),
    sb.from("agent_memory").select("key,value").eq("user_id", userId).eq("kind", "context")
      .like("key", "life:%").limit(20),
  ]);
  const saved = new Map<string, number>();
  for (const row of (((contribRes as any)?.data ?? []) as any[])) {
    saved.set(String(row.goal_id), (saved.get(String(row.goal_id)) ?? 0) + Number(row.amount ?? 0));
  }
  const goals = (((goalsRes as any)?.data ?? []) as any[])
    .filter((g) => String(g.kind ?? "savings") !== "donation")
    .map((g) => ({
      id: String(g.id),
      name: String(g.name ?? "Meta"),
      target_amount: Number(g.target_amount ?? 0),
      saved_amount: saved.get(String(g.id)) ?? 0,
      target_date: g.target_date ? String(g.target_date) : null,
      monthly_target: g.monthly_target == null ? null : Number(g.monthly_target),
    }));
  const lifeNotes = (((memoryRes as any)?.data ?? []) as any[])
    .map((row) => {
      const value = row.value as any;
      return typeof value === "string" ? value : String(value?.note ?? "");
    })
    .filter(Boolean);
  return buildUserModel({ today, goals, lifeNotes });
}

/** Entregas confirmadas recentes, para a janela anti-repetição por tipo. */
export async function loadRecentDeliveries(sb: SupabaseClient, userId: string, days = 8): Promise<RecentDelivery[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await sb.from("communication_deliveries")
    .select("kind,channel,status,created_at,delivered_at,evidence")
    .eq("user_id", userId)
    .gte("created_at", since)
    .in("status", ["queued", "sent", "delivered", "acted"])
    .limit(300);
  return (((data as any[]) ?? [])).map((row) => ({
    kind: String(row.kind ?? ""),
    channel: String(row.channel ?? "app"),
    delivered_at: String(row.delivered_at ?? row.created_at),
    impact_amount: Number((row.evidence as any)?.impact_amount ?? 0) || null,
  }));
}
