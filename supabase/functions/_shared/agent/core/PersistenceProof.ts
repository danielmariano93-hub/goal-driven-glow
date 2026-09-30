// PersistenceProof (`nino_agent.v2`) — proof of state before a success receipt.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type ProofTarget = { table: string; id: string } | null;
export type PersistenceProof = {
  proven: boolean;
  reason: string | null;
  table: string | null;
  id: string | null;
};

const TABLE_BY_KIND: Record<string, string> = {
  transaction: "transactions",
  bulk_transactions: "transactions",
  transaction_update: "transactions",
  transaction_delete: "transactions",
  transfer: "transactions",
  goal: "goals",
  goal_create: "goals",
  goal_contribution: "goal_contributions",
  goal_update: "goals",
  goal_delete: "goals",
  spending_goal_plan: "category_spending_goals",
  shared_goal_create: "shared_goals",
  shared_goal_contribution: "shared_goal_contributions",
  shared_expense: "shared_expenses",
  split_receive: "shared_expense_participants",
  split_update: "shared_expenses",
  split_delete: "shared_expenses",
  debt: "debts",
  debt_payment: "debt_payments",
  category_create: "categories",
  category_update: "categories",
  category_delete: "categories",
  recurring_create: "recurring_rules",
  recurring_update: "recurring_rules",
  recurring_delete: "recurring_rules",
  credit_card_payment: "credit_card_payments",
  emotional_checkin: "emotional_checkins",
};

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function proofTarget(kind: string, result: unknown): ProofTarget {
  const table = TABLE_BY_KIND[String(kind ?? "").trim()];
  if (!table) return null;
  const r = (result ?? {}) as any;
  const preferred: Record<string, unknown[]> = {
    debt_payment: [r.payment_id],
    goal_create: [r.goal_id], goal_update: [r.goal_id], goal_delete: [r.goal_id],
    category_create: [r.category_id], category_update: [r.category_id], category_delete: [r.category_id],
    split_receive: [r.participant_id], split_update: [r.shared_expense_id], split_delete: [r.shared_expense_id],
    recurring_create: [r.recurring_id], recurring_update: [r.recurring_id], recurring_delete: [r.recurring_id],
  };
  const candidates = [
    ...(preferred[kind] ?? []),
    r.id, r.transaction_id, r.goal_id, r.contribution_id, r.debt_id,
    r.shared_expense_id, r.shared_goal_id, r.payment_id, r.checkin_id,
    Array.isArray(r.ids) ? r.ids[0] : null,
    Array.isArray(r.transactions) ? (r.transactions[0]?.id ?? null) : null,
  ];
  const id = candidates.map((c) => (typeof c === "string" ? c.trim() : "")).find((c) => UUID_RX.test(c));
  return id ? { table, id } : null;
}

function ownerColumn(kind: string): string {
  if (["shared_expense", "split_update", "split_delete", "split_receive"].includes(kind)) return "owner_user_id";
  return "user_id";
}

export async function verifyPersisted(
  sb: SupabaseClient,
  args: { kind: string; user_id: string; result: unknown; idempotent?: boolean },
): Promise<PersistenceProof> {
  const target = proofTarget(args.kind, args.result);
  if (!target) {
    return {
      proven: !!args.idempotent,
      reason: args.idempotent ? null : "no_proof_target",
      table: TABLE_BY_KIND[String(args.kind ?? "")] ?? null,
      id: null,
    };
  }

  try {
    const owner = ownerColumn(args.kind);

    // Goal create may contain a dependent initial contribution. Success is only
    // proven if every requested row exists and belongs to the same user/goal.
    if (args.kind === "goal_create") {
      const result = (args.result ?? {}) as any;
      const { data: goal, error: goalError } = await (sb.from("goals") as any)
        .select("id").eq("id", target.id).eq("user_id", args.user_id).maybeSingle();
      if (goalError) return { proven: false, reason: `read_back_failed:${goalError.message}`, ...target };
      if (!goal) return { proven: false, reason: "goal_row_not_found", ...target };
      const contributionId = String(result.contribution_id ?? "").trim();
      if (contributionId && UUID_RX.test(contributionId)) {
        const { data: contribution, error: contributionError } = await (sb.from("goal_contributions") as any)
          .select("id,goal_id").eq("id", contributionId).eq("user_id", args.user_id).eq("goal_id", target.id).maybeSingle();
        if (contributionError) return { proven: false, reason: `read_back_failed:${contributionError.message}`, ...target };
        if (!contribution) return { proven: false, reason: "initial_contribution_not_found", ...target };
      }
      return { proven: true, reason: null, ...target };
    }

    // A delete is proven by absence, not by finding the old row. This also fixes
    // the long-standing transaction_delete false-negative proof.
    if (args.kind === "transaction_delete" || args.kind === "goal_delete") {
      const { data, error } = await (sb.from(target.table) as any)
        .select("id").eq("id", target.id).eq(owner, args.user_id).maybeSingle();
      if (error) return { proven: false, reason: `read_back_failed:${error.message}`, ...target };
      return data
        ? { proven: false, reason: "row_still_exists", ...target }
        : { proven: true, reason: null, ...target };
    }

    if (args.kind === "category_delete") {
      const { data, error } = await (sb.from(target.table) as any)
        .select("id,archived_at").eq("id", target.id).eq("user_id", args.user_id).maybeSingle();
      if (error) return { proven: false, reason: `read_back_failed:${error.message}`, ...target };
      return data?.archived_at
        ? { proven: true, reason: null, ...target }
        : { proven: false, reason: data ? "category_not_archived" : "row_not_found", ...target };
    }

    if (args.kind === "split_delete") {
      const { data, error } = await (sb.from(target.table) as any)
        .select("id,deleted_at,status").eq("id", target.id).eq("owner_user_id", args.user_id).maybeSingle();
      if (error) return { proven: false, reason: `read_back_failed:${error.message}`, ...target };
      return data?.deleted_at && data?.status === "cancelled"
        ? { proven: true, reason: null, ...target }
        : { proven: false, reason: "split_not_deleted", ...target };
    }

    if (args.kind === "recurring_delete") {
      const { data, error } = await (sb.from(target.table) as any)
        .select("id,status").eq("id", target.id).eq("user_id", args.user_id).maybeSingle();
      if (error) return { proven: false, reason: `read_back_failed:${error.message}`, ...target };
      return data?.status === "finished"
        ? { proven: true, reason: null, ...target }
        : { proven: false, reason: "recurring_not_finished", ...target };
    }

    let q = (sb.from(target.table) as any).select("id").eq("id", target.id).limit(1);
    q = q.eq(owner, args.user_id);
    const { data, error } = await q.maybeSingle();
    if (error) return { proven: false, reason: `read_back_failed:${error.message}`, ...target };
    if (!data) return { proven: false, reason: "row_not_found", ...target };
    return { proven: true, reason: null, ...target };
  } catch (e) {
    return { proven: false, reason: `read_back_threw:${String((e as Error).message).slice(0, 120)}`, ...target };
  }
}

export function unprovenMessage(): string {
  return "Não consegui confirmar o registro no seu histórico agora. Não vou dizer que salvei sem ter certeza — pode tentar de novo em instantes? 💛";
}