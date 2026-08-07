// FinancialContext360 — on-demand loader for consolidated financial context.
// Called by AgentCore only when the intent needs richer context than what
// individual tools already provide. Keeps token cost predictable by never
// loading everything eagerly.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { get_financial_snapshot, list_accounts, list_credit_cards, list_recent_transactions, list_category_spending_goals } from "../tools.ts";

export type Snapshot360 = {
  summary?: unknown;
  accounts?: unknown;
  cards?: unknown;
  recent?: unknown;
  metrics?: unknown;
  categoryGoals?: unknown;
};

export type ContextRequest = {
  summary?: boolean;
  accounts?: boolean;
  cards?: boolean;
  recent?: number | boolean;
  metrics?: boolean;
  categoryGoals?: boolean;
};

export async function buildSnapshot(
  sb: SupabaseClient,
  user_id: string,
  conversation_id: string,
  req: ContextRequest,
): Promise<Snapshot360> {
  const ctx = { sb, user_id, conversation_id };
  const out: Snapshot360 = {};
  const tasks: Promise<void>[] = [];
  // Summary and metrics must come from the exact same canonical snapshot.
  // The former implementation queried raw transactions separately and could
  // disagree with Home/Reports about transfers, card payments and statuses.
  let financialSnapshot: ReturnType<typeof get_financial_snapshot> | null = null;
  const loadFinancial = () => financialSnapshot ??= get_financial_snapshot(ctx);
  if (req.summary || req.metrics) tasks.push(loadFinancial().then(r => {
    if (!r.ok) return;
    if (req.metrics) out.metrics = r.result;
    if (req.summary) out.summary = {
      month: String(r.result?.month_start ?? "").slice(0, 7),
      income: r.result?.current_month_income ?? 0,
      expense: r.result?.current_month_expense ?? 0,
      net: r.result?.period_performance?.operational_result
        ?? Number(r.result?.current_month_income ?? 0) - Number(r.result?.current_month_expense ?? 0),
      formula_version: r.result?.formula_version,
    };
  }));
  if (req.accounts) tasks.push(list_accounts(ctx).then(r => { if (r.ok) out.accounts = r.result; }));
  if (req.cards) tasks.push(list_credit_cards(ctx).then(r => { if (r.ok) out.cards = r.result; }));
  if (req.recent) {
    const limit = typeof req.recent === "number" ? req.recent : 5;
    tasks.push(list_recent_transactions(ctx, { limit }).then(r => { if (r.ok) out.recent = r.result; }));
  }
  if (req.categoryGoals) tasks.push(list_category_spending_goals(ctx).then(r => { if (r.ok) out.categoryGoals = r.result; }));
  await Promise.all(tasks);
  return out;
}
