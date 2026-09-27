// UndoLifecycleTools — safe compensating drafts for the immediately previous
// confirmed mutation. Unsupported/risky operations fail closed; no silent
// partial rollback is ever attempted.
// deno-lint-ignore-file no-explicit-any

import { draft_transaction_delete, type ToolContext, type ToolResult } from "../tools.ts";

async function upsertDraft(
  ctx: ToolContext,
  kind: string,
  payload: Record<string, unknown>,
  summary: string,
): Promise<ToolResult> {
  const { data, error } = await ctx.sb.rpc("agent_upsert_draft", {
    p_user_id: ctx.user_id,
    p_conversation_id: ctx.conversation_id,
    p_kind: kind,
    p_payload: payload,
    p_summary: summary,
    p_ttl_minutes: 15,
  });
  if (error || !data) return { ok: false, error: `draft_persistence_failed:${error?.message ?? "empty_id"}` };
  return { ok: true, result: { draft_id: String(data), summary } };
}

async function undoLast(ctx: ToolContext): Promise<ToolResult> {
  const { data: last, error } = await ctx.sb.from("pending_confirmations")
    .select("id,kind,payload,result_snapshot,executed_at")
    .eq("user_id", ctx.user_id)
    .eq("conversation_id", ctx.conversation_id)
    .eq("status", "confirmed")
    .order("executed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: `undo_lookup_failed:${error.message}` };
  if (!last) return { ok: false, error: "undo_nothing_to_reverse" };

  const kind = String(last.kind ?? "");
  const result = (last.result_snapshot ?? {}) as Record<string, any>;
  const source = { undo_source_confirmation_id: String(last.id) };

  // A simple one-row transaction creation has an exact inverse through the
  // existing canonical transaction-delete draft. Compound/card/split/transfer
  // shapes are deliberately excluded because their inverse spans more state.
  if (kind === "transaction" && result.transaction_id) {
    const { data: tx, error: txError } = await ctx.sb.from("transactions")
      .select("id,description,purchase_group_id,transfer_group_id,shared_expense_id,split_transaction_role")
      .eq("id", result.transaction_id)
      .eq("user_id", ctx.user_id)
      .maybeSingle();
    if (txError) return { ok: false, error: `undo_transaction_lookup_failed:${txError.message}` };
    if (!tx) return { ok: false, error: "undo_already_reversed" };
    if (tx.purchase_group_id || tx.transfer_group_id || tx.shared_expense_id || tx.split_transaction_role) {
      return { ok: false, error: "undo_last_requires_specialized_reversal" };
    }
    return await draft_transaction_delete(ctx, {
      transaction_id: tx.id,
      scope: "one",
      ...source,
    } as any);
  }

  // Goal creation (including the new atomic goal+initial-contribution command)
  // is exactly reversible because deleting the newly-created goal removes its
  // dependent contributions in the same database transaction/cascade.
  if ((kind === "goal_create" || kind === "goal") && result.goal_id) {
    const { data: goal, error: goalError } = await ctx.sb.from("goals")
      .select("id,name,target_amount,target_date,status,priority,notes")
      .eq("id", result.goal_id)
      .eq("user_id", ctx.user_id)
      .maybeSingle();
    if (goalError) return { ok: false, error: `undo_goal_lookup_failed:${goalError.message}` };
    if (!goal) return { ok: false, error: "undo_already_reversed" };
    return await upsertDraft(
      ctx,
      "goal_delete",
      { goal_id: goal.id, before: goal, ...source },
      `Desfazer a criação da meta “${goal.name}”.`,
    );
  }

  return {
    ok: false,
    error: "undo_last_not_safely_reversible",
    result: { last_kind: kind },
  };
}

export function undoLifecycleToolByName(name: string): { execute: (ctx: ToolContext, args: any) => Promise<ToolResult> } | null {
  return name === "lifecycle_undo_last_draft" ? { execute: (ctx) => undoLast(ctx) } : null;
}
