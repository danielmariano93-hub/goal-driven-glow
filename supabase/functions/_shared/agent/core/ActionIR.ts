// Canonical write action contract for the Nino conversation brain.
// The model may interpret the requested action; only the runtime maps it to a draft tool.

import type { WriteWorkflowKind } from "./WriteWorkflowManager.ts";

export const ACTION_KINDS = [
  "transaction.create",
  "transfer.create",
  "goal.create",
  "goal.contribute",
  "debt.create",
  "card_bill.pay",
  "split.create",
] as const;

export type ActionKind = typeof ACTION_KINDS[number];

export type ActionIR = {
  version: "action_ir.v1";
  action: ActionKind;
  slots: Record<string, unknown>;
};

const ACTION_TO_TOOL: Record<ActionKind, WriteWorkflowKind> = {
  "transaction.create": "create_transaction_draft",
  "transfer.create": "create_transfer_draft",
  "goal.create": "create_goal_draft",
  "goal.contribute": "add_goal_contribution_draft",
  "debt.create": "create_debt_draft",
  "card_bill.pay": "pay_credit_card_bill_draft",
  "split.create": "create_split_expense_draft",
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
