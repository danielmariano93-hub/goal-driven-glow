// FinancialContext360 — on-demand loader for consolidated financial context.
// Called by AgentCore only when the intent needs richer context than what
// individual tools already provide. Keeps token cost predictable by never
// loading everything eagerly.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { get_financial_summary, list_accounts, list_credit_cards, list_recent_transactions } from "../tools.ts";

export type Snapshot360 = {
  summary?: unknown;
  accounts?: unknown;
  cards?: unknown;
  recent?: unknown;
};

export type ContextRequest = {
  summary?: boolean;
  accounts?: boolean;
  cards?: boolean;
  recent?: number | boolean;
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
  if (req.summary) tasks.push(get_financial_summary(ctx).then(r => { if (r.ok) out.summary = r.result; }));
  if (req.accounts) tasks.push(list_accounts(ctx).then(r => { if (r.ok) out.accounts = r.result; }));
  if (req.cards) tasks.push(list_credit_cards(ctx).then(r => { if (r.ok) out.cards = r.result; }));
  if (req.recent) {
    const limit = typeof req.recent === "number" ? req.recent : 5;
    tasks.push(list_recent_transactions(ctx, { limit }).then(r => { if (r.ok) out.recent = r.result; }));
  }
  await Promise.all(tasks);
  return out;
}
