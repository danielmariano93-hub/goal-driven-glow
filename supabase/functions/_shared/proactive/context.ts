// deno-lint-ignore-file no-explicit-any
// proactive_multifinance.v1 — contexto multi-financeiro do usuário.
// Uma única leitura canônica alimenta todos os domínios: o motor proativo nunca
// consulta transações por conta própria nem recalcula saldo.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computeAgentSnapshot } from "../engine/metrics.ts";
import { materialityFloor } from "../intelligence/insightValue.ts";
import {
  PROACTIVE_MULTIFINANCE_VERSION,
  type MultiFinanceProactiveContext,
} from "./contracts.ts";
import { buildCashHorizon, round2 } from "./cashHorizon.ts";

export { buildCashHorizon };

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Aprendizado por tipo: quem foi dispensado ou marcado como inútil perde valor. */
async function loadLearning(sb: SupabaseClient, userId: string) {
  const learning: MultiFinanceProactiveContext["learning"] = {};
  const { data } = await sb.from("communication_deliveries")
    .select("kind,user_feedback,false_positive,interacted_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(300);
  for (const row of ((data as any[]) ?? [])) {
    const kind = String(row.kind ?? "");
    if (!kind) continue;
    const entry = learning[kind] ??= { dismissals: 0, actions: 0, false_positives: 0 };
    if (row.false_positive === true) entry.false_positives += 1;
    if (row.user_feedback === "dismissed" || row.user_feedback === "not_useful") entry.dismissals += 1;
    if (row.user_feedback === "useful" || row.interacted_at) entry.actions += 1;
  }
  return learning;
}

export async function buildMultiFinanceProactiveContext(
  sb: SupabaseClient,
  userId: string,
): Promise<MultiFinanceProactiveContext> {
  const [snapshot, learning, itemsRes] = await Promise.all([
    computeAgentSnapshot(sb, userId),
    loadLearning(sb, userId),
    sb.from("nino_intelligence_items")
      .select("id,kind,severity,title,summary,confidence,impact_amount,primary_action,logical_topic_key,valid_until,dismissed_at,status")
      .eq("user_id", userId)
      .eq("status", "active")
      .is("dismissed_at", null)
      .in("kind", ["pattern", "risk", "opportunity", "achievement"])
      .order("priority", { ascending: false })
      .limit(20),
  ]);

  const agenda = (snapshot as any).commitment_agenda ?? { items: [] };
  const commitments = (agenda.items ?? []) as any[];
  const monthlyIncome = Math.max(
    num(snapshot.current_month_income),
    num(snapshot.estimated_fixed_income) + num(snapshot.confirmed_future_income),
  );
  const cashHorizon = buildCashHorizon({
    today: snapshot.today,
    availableToday: num(snapshot.available_today),
    incomeEvents: (snapshot.estimated_income_events ?? []).map((event: any) => ({
      date: String(event.date), amount: num(event.amount), label: String(event.label ?? "Entrada prevista"),
    })),
    commitments: commitments.map((item) => ({
      date: String(item.date), amount: num(item.amount), type: String(item.type), name: String(item.name ?? ""),
    })),
  });
  const nextCardDue = commitments
    .filter((item) => String(item.source ?? "").startsWith("card_"))
    .map((item) => String(item.date))
    .sort()[0] ?? null;

  return {
    version: PROACTIVE_MULTIFINANCE_VERSION,
    user_id: userId,
    as_of: snapshot.today,
    monthly_income: round2(monthlyIncome),
    materiality_floor: round2(materialityFloor(monthlyIncome)),
    available_today: num(snapshot.available_today),
    projected_month_end_available: num(snapshot.projected_month_end_available),
    daily_pace: num(snapshot.daily_pace),
    typical_daily_pace: num(snapshot.typical_daily_pace),
    cash_horizon: cashHorizon,
    first_negative_day: cashHorizon.find((point) => point.balance < 0) ?? null,
    snapshot_ref: {
      reconciliation_id: snapshot.reconciliation_id,
      formula_version: snapshot.formula_version,
    },
    domains: {
      cash: {
        month_start: snapshot.month_start,
        month_end: snapshot.month_end,
        days_remaining: snapshot.days_remaining,
        known_future_commitments: snapshot.known_future_commitments,
        estimated_fixed_income: snapshot.estimated_fixed_income,
        confirmed_future_income: snapshot.confirmed_future_income,
        period_performance: snapshot.period_performance,
      },
      cards: {
        cards_owed: snapshot.cards_owed,
        card_due_this_month: snapshot.card_due_this_month,
        card_due_estimated: snapshot.card_due_estimated,
        card_future_installments: snapshot.card_future_installments,
        next_card_due_date: nextCardDue,
      },
      goals: snapshot.active_category_goals ?? [],
      commitments,
      debts: snapshot.active_debts ?? [],
      patterns: ((itemsRes as any)?.data as any[]) ?? [],
    },
    learning,
  };
}
