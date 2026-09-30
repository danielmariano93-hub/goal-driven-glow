// Canonical write action contract for the Nino conversation brain.
// The model may interpret the requested action; only the runtime maps it to a draft tool.

import type { WriteWorkflowKind } from "./WriteWorkflowManager.ts";

export const ACTION_KINDS = [
  "transaction.create",
  "transaction.update",
  "transaction.delete",
  "transfer.create",
  "goal.create",
  "goal.contribute",
  "goal.update",
  "goal.delete",
  "spending_goal.plan",
  "debt.create",
  "debt.pay",
  "card_bill.pay",
  "category.create",
  "category.update",
  "category.delete",
  "split.create",
  "split.receive",
  "split.update",
  "split.delete",
  "recurring.create",
  "recurring.update",
  "recurring.delete",
  "undo.last",
] as const;

export type ActionKind = typeof ACTION_KINDS[number];

export type ActionIR = {
  version: "action_ir.v1";
  action: ActionKind;
  slots: Record<string, unknown>;
};

const ACTION_TO_TOOL: Record<ActionKind, WriteWorkflowKind> = {
  "transaction.create": "create_transaction_draft",
  "transaction.update": "lifecycle_transaction_update_draft",
  "transaction.delete": "lifecycle_transaction_delete_draft",
  "transfer.create": "create_transfer_draft",
  // Goal creation now uses the lifecycle executor so a create + initial
  // contribution can be confirmed and committed in one atomic database action.
  "goal.create": "lifecycle_goal_create_draft",
  "goal.contribute": "add_goal_contribution_draft",
  "goal.update": "lifecycle_goal_update_draft",
  "goal.delete": "lifecycle_goal_delete_draft",
  // Meta de GASTO (teto por categoria) e submetas por estabelecimento.
  "spending_goal.plan": "lifecycle_spending_goal_plan_draft",
  "debt.create": "create_debt_draft",
  "debt.pay": "lifecycle_debt_payment_draft",
  "card_bill.pay": "pay_credit_card_bill_draft",
  "category.create": "lifecycle_category_create_draft",
  "category.update": "lifecycle_category_update_draft",
  "category.delete": "lifecycle_category_delete_draft",
  "split.create": "create_split_expense_draft",
  "split.receive": "lifecycle_split_receive_draft",
  "split.update": "lifecycle_split_update_draft",
  "split.delete": "lifecycle_split_delete_draft",
  "recurring.create": "lifecycle_recurring_create_draft",
  "recurring.update": "lifecycle_recurring_update_draft",
  "recurring.delete": "lifecycle_recurring_delete_draft",
  "undo.last": "lifecycle_undo_last_draft",
};

export function toolForAction(action: ActionKind): WriteWorkflowKind {
  return ACTION_TO_TOOL[action];
}

export function actionForTool(tool: WriteWorkflowKind): ActionKind | null {
  for (const [action, mapped] of Object.entries(ACTION_TO_TOOL)) {
    if (mapped === tool) return action as ActionKind;
  }
  return null;
}

export function isActionKind(value: unknown): value is ActionKind {
  return ACTION_KINDS.includes(String(value) as ActionKind);
}

export function validateActionIR(value: unknown): string[] {
  const ir = value as Partial<ActionIR> | null;
  if (!ir || typeof ir !== "object") return ["action_ir_not_object"];
  const errors: string[] = [];
  if (ir.version !== "action_ir.v1") errors.push("action_ir_version_invalid");
  if (!isActionKind(ir.action)) errors.push("action_ir_action_invalid");
  if (!ir.slots || typeof ir.slots !== "object" || Array.isArray(ir.slots)) {
    errors.push("action_ir_slots_invalid");
  }
  return errors;
}

export function compactActionSlots(slots: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(slots ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export function mergeActionSlots(
  previous: Record<string, unknown> | null | undefined,
  current: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return { ...compactActionSlots(previous), ...compactActionSlots(current) };
}