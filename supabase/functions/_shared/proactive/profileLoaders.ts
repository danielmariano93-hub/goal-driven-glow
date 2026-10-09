// deno-lint-ignore-file no-explicit-any
// Leituras do perfil do usuário para o motor proativo: qualidade do dado e
// modelo do usuário. Só LEEM; todo cálculo fica nas funções puras de
// `dataQuality.ts` e `userModel.ts`.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computeMonthlyTotals, type TransactionRow } from "../finance-core/facts.ts";
import { assessDataQuality, type DataQuality } from "./dataQuality.ts";
import { buildUserModel, type UserModel } from "./userModel.ts";
import type { RecentDelivery } from "./repetition.ts";
import { tipIdFromKey, type DiscoveryHistory, type UsageProfile } from "./featureDiscovery.ts";
import type { CardCycle } from "./reminders.ts";

function ymShift(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function loadDataQuality(
  sb: SupabaseClient,
  userId: string,
  facts: { today: string; current_month_income: number; expected_income_rest_of_month: number; current_month_expense?: number },
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
    current_month_expense: facts.current_month_expense,
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

/** Interações com a fila de prioridades (Home/Nino), para o aprendizado. */
export async function loadPriorityEvents(sb: SupabaseClient, userId: string, days = 45) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await sb.from("nino_priority_events")
    .select("kind,fingerprint,event,created_at")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  return (((data as any[]) ?? [])).map((row) => ({
    kind: String(row.kind ?? ""),
    fingerprint: String(row.fingerprint ?? ""),
    event: String(row.event ?? ""),
    created_at: String(row.created_at ?? ""),
  }));
}

/** Assuntos dispensados pela pessoa (regra única no banco: `nino_dismissed_topics`). */
export async function loadDismissedTopics(sb: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await sb.rpc("nino_dismissed_topics", { _user_id: userId });
  if (error) throw new Error(`nino_dismissed_topics:${error.message}`);
  return Array.isArray(data) ? (data as unknown[]).map(String) : [];
}

/**
 * Gastos por categoria da janela do aviso matinal: 12 semanas (padrão do dia da
 * semana) e os 3 meses fechados anteriores (referência de média) + mês corrente.
 */
export async function loadNudgeTransactions(sb: SupabaseClient, userId: string, today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const weeksFrom = new Date(Date.UTC(y, m - 1, d - 7 * 12)).toISOString().slice(0, 10);
  const monthsFrom = new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 10);
  const from = weeksFrom < monthsFrom ? weeksFrom : monthsFrom;
  const [txRes, catRes] = await Promise.all([
    sb.from("transactions")
      .select("occurred_at,amount,category_id,movement_kind,payment_method")
      .eq("user_id", userId).eq("status", "confirmed").eq("type", "expense")
      .gte("occurred_at", from).lt("occurred_at", today)
      .order("occurred_at", { ascending: false })
      .limit(1000),
    sb.from("categories").select("id,name").or(`user_id.eq.${userId},user_id.is.null`),
  ]);
  const names = new Map<string, string>();
  for (const row of (((catRes as any)?.data ?? []) as any[])) names.set(String(row.id), String(row.name));
  return (((txRes as any)?.data ?? []) as any[])
    .filter((row) => !row.movement_kind || row.movement_kind === "transaction")
    .map((row) => ({
      occurred_at: String(row.occurred_at),
      amount: Math.abs(Number(row.amount ?? 0)),
      category: row.category_id ? names.get(String(row.category_id)) ?? null : null,
      payment_method: row.payment_method ? String(row.payment_method) : null,
    }));
}

/** Previsões de fim de semana entregues na sexta `friday` (base do fechamento de segunda). */
export async function loadDeliveredWeekendForecasts(sb: SupabaseClient, userId: string, friday: string) {
  const { data } = await sb.from("proactive_situations")
    .select("fingerprint,evidence,last_delivered_at")
    .eq("user_id", userId).eq("as_of", friday)
    .like("fingerprint", "nino_weekend_forecast.v1:%")
    .not("last_delivered_at", "is", null)
    .limit(10);
  return (((data as any[]) ?? []) as any[])
    .map((row) => ({ forecast: row?.evidence?.forecast }))
    .filter((row) => row.forecast && typeof row.forecast.category === "string");
}

/** Metas mensais ativas por nome de categoria (âncora da projeção do aviso matinal). */
export async function loadNudgeGoals(sb: SupabaseClient, userId: string): Promise<Record<string, { name: string; limit: number }>> {
  const [goalsRes, catRes] = await Promise.all([
    sb.from("category_spending_goals").select("category_id,computed_limit,status,period_type")
      .eq("user_id", userId).eq("status", "active"),
    sb.from("categories").select("id,name").or(`user_id.eq.${userId},user_id.is.null`),
  ]);
  const names = new Map<string, string>();
  for (const row of (((catRes as any)?.data ?? []) as any[])) names.set(String(row.id), String(row.name));
  const out: Record<string, { name: string; limit: number }> = {};
  for (const row of (((goalsRes as any)?.data ?? []) as any[])) {
    if ((row.period_type ?? "monthly_recurring") !== "monthly_recurring") continue;
    const name = names.get(String(row.category_id));
    const limit = Number(row.computed_limit ?? 0);
    if (name && limit > 0) out[name] = { name, limit };
  }
  return out;
}

/** Cartões ativos com dia de fechamento (lembrete "fecha em 2 dias"). */
export async function loadCardCycles(sb: SupabaseClient, userId: string): Promise<CardCycle[]> {
  const { data } = await sb.from("credit_cards").select("id,name,closing_day")
    .eq("user_id", userId).eq("active", true).limit(20);
  return ((data as any[]) ?? []).map((row) => ({
    id: String(row.id), name: String(row.name ?? "cartão"), closing_day: row.closing_day == null ? null : Number(row.closing_day),
  }));
}

/** O que a pessoa já usa do Nino (só contagens) e as dicas que já recebeu. */
export async function loadDiscoveryInputs(sb: SupabaseClient, userId: string): Promise<{
  usage: UsageProfile;
  history: DiscoveryHistory;
}> {
  const count = async (query: any): Promise<number> => {
    const { count: total, error } = await query;
    if (error) throw error;
    return Number(total ?? 0);
  };
  const head = { count: "exact" as const, head: true };
  const [recurring, goals, cards, imports, splits, inbound, questions, sentRes] = await Promise.all([
    count(sb.from("recurring_rules").select("id", head).eq("user_id", userId)),
    count(sb.from("goals").select("id", head).eq("user_id", userId)),
    count(sb.from("credit_cards").select("id", head).eq("user_id", userId).eq("active", true)),
    count(sb.from("document_imports").select("id", head).eq("user_id", userId).not("invoice_total", "is", null)),
    count(sb.from("shared_expenses").select("id", head).eq("owner_user_id", userId)),
    count(sb.from("conversation_messages").select("id", head).eq("user_id", userId).eq("direction", "inbound")),
    count(sb.from("conversation_messages").select("id", head).eq("user_id", userId).eq("direction", "inbound")
      .or("body_masked.ilike.%?%,body_masked.ilike.%quanto%")),
    sb.from("communication_deliveries").select("dedup_key,created_at")
      .eq("user_id", userId).eq("kind", "feature_discovery")
      .in("status", ["queued", "sent", "delivered", "acted"])
      .order("created_at", { ascending: false }).limit(50),
  ]);
  const sent = ((sentRes as any)?.data as any[]) ?? [];
  return {
    usage: {
      recurring_rules: recurring, goals, active_cards: cards, invoice_imports: imports,
      splits, inbound_messages: inbound, questions_asked: questions,
    },
    history: {
      sent_tip_ids: sent.map((row) => tipIdFromKey(row.dedup_key)).filter((id): id is string => !!id),
      last_sent_at: sent[0]?.created_at ?? null,
    },
  };
}
