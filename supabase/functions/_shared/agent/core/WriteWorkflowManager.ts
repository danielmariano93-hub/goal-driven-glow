// WriteWorkflowManager (`nino_write_workflow.v2`)
// Durable multi-turn WRITE state. The workflow carries semantic intent/slots
// until a safe draft can be prepared; financial state is changed only after
// the canonical confirmation executor runs.
// deno-lint-ignore-file no-explicit-any

export const WRITE_WORKFLOW_KINDS = [
  "create_transaction_draft",
  "lifecycle_transaction_update_draft",
  "lifecycle_transaction_delete_draft",
  "create_transfer_draft",
  "pay_credit_card_bill_draft",
  "create_split_expense_draft",
  "lifecycle_split_receive_draft",
  "lifecycle_split_update_draft",
  "lifecycle_split_delete_draft",
  "create_goal_draft",
  "lifecycle_goal_create_draft",
  "add_goal_contribution_draft",
  "lifecycle_goal_update_draft",
  "lifecycle_goal_delete_draft",
  "create_debt_draft",
  "lifecycle_debt_payment_draft",
  "lifecycle_category_create_draft",
  "lifecycle_category_update_draft",
  "lifecycle_category_delete_draft",
  "lifecycle_recurring_create_draft",
  "lifecycle_recurring_update_draft",
  "lifecycle_recurring_delete_draft",
  "lifecycle_undo_last_draft",
] as const;
export type WriteWorkflowKind = typeof WRITE_WORKFLOW_KINDS[number];

export const REQUIRED_SLOTS: Record<WriteWorkflowKind, string[]> = {
  create_transaction_draft: ["amount"],
  lifecycle_transaction_update_draft: ["transaction"],
  lifecycle_transaction_delete_draft: ["transaction"],
  create_transfer_draft: ["amount", "from_account", "to_account"],
  pay_credit_card_bill_draft: ["amount", "card"],
  create_split_expense_draft: ["title", "total", "participants"],
  lifecycle_split_receive_draft: ["participant"],
  lifecycle_split_update_draft: ["split"],
  lifecycle_split_delete_draft: ["split"],
  create_goal_draft: ["name", "target_amount"],
  lifecycle_goal_create_draft: ["name", "target_amount"],
  add_goal_contribution_draft: ["goal", "amount"],
  lifecycle_goal_update_draft: ["goal"],
  lifecycle_goal_delete_draft: ["goal"],
  create_debt_draft: ["name", "original_amount"],
  lifecycle_debt_payment_draft: ["debt"],
  lifecycle_category_create_draft: ["name"],
  lifecycle_category_update_draft: ["category"],
  lifecycle_category_delete_draft: ["category"],
  // Name/amount are universally required. Daily/weekly/monthly/yearly schedule
  // requirements are validated by the frequency-aware recurring adapter.
  lifecycle_recurring_create_draft: ["name", "amount"],
  lifecycle_recurring_update_draft: ["recurring"],
  lifecycle_recurring_delete_draft: ["recurring"],
  lifecycle_undo_last_draft: [],
};

const SLOT_QUESTION: Record<string, string> = {
  amount: "Qual foi o valor?",
  from_account: "Sai de qual conta?",
  to_account: "Vai para qual conta?",
  card: "Qual cartão?",
  transaction: "Qual lançamento você quer alterar?",
  title: "Qual o nome desse rolê?",
  total: "Qual o valor total?",
  participants: "Quem participou?",
  participant: "Quem fez o pagamento?",
  split: "Qual divisão do rolê você quer alterar?",
  name: "Qual o nome?",
  target_amount: "Qual o valor da meta?",
  goal: "Para qual meta?",
  original_amount: "Qual o valor original da dívida?",
  debt: "Qual dívida?",
  category: "Qual categoria?",
  recurring: "Qual recorrência?",
  day_of_month: "Em qual dia do mês deve acontecer?",
};

export type WriteWorkflow = {
  id: string | null;
  kind: WriteWorkflowKind;
  slots: Record<string, unknown>;
  asked_slot: string | null;
  turns: number;
  updated_at?: string;
};

export type WorkflowStep =
  | { status: "complete"; kind: WriteWorkflowKind; args: Record<string, unknown> }
  | { status: "needs_slot"; kind: WriteWorkflowKind; slot: string; question: string }
  | { status: "abandoned"; kind: WriteWorkflowKind; reason: string };

export const MAX_WORKFLOW_TURNS = 6;

export function missingSlots(workflow: WriteWorkflow): string[] {
  return (REQUIRED_SLOTS[workflow.kind] ?? []).filter((slot) => {
    const value = workflow.slots?.[slot];
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  });
}

export function nextStep(workflow: WriteWorkflow): WorkflowStep {
  if (workflow.turns >= MAX_WORKFLOW_TURNS) {
    return { status: "abandoned", kind: workflow.kind, reason: "max_turns" };
  }
  const missing = missingSlots(workflow);
  if (!missing.length) {
    return { status: "complete", kind: workflow.kind, args: { ...workflow.slots } };
  }
  const slot = missing[0];
  return {
    status: "needs_slot",
    kind: workflow.kind,
    slot,
    question: SLOT_QUESTION[slot] ?? `Me confirma ${slot}?`,
  };
}

export function applySlotAnswer(
  workflow: WriteWorkflow,
  value: unknown,
): WriteWorkflow {
  if (!workflow.asked_slot) return workflow;
  return {
    ...workflow,
    slots: { ...workflow.slots, [workflow.asked_slot]: value },
    asked_slot: null,
    turns: workflow.turns + 1,
  };
}

export async function loadWorkflow(
  sb: any,
  args: { user_id: string; conversation_id: string },
): Promise<WriteWorkflow | null> {
  const { data, error } = await sb.from("pending_write_workflows")
    .select("id,kind,slots,asked_slot,turns,updated_at")
    .eq("user_id", args.user_id)
    .eq("conversation_id", args.conversation_id)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  if (!WRITE_WORKFLOW_KINDS.includes(data.kind)) return null;
  return {
    id: data.id,
    kind: data.kind,
    slots: (data.slots ?? {}) as Record<string, unknown>,
    asked_slot: data.asked_slot ?? null,
    turns: Number(data.turns ?? 0),
    updated_at: data.updated_at,
  };
}

export async function saveWorkflow(
  sb: any,
  args: { user_id: string; conversation_id: string; workflow: WriteWorkflow },
): Promise<void> {
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await sb.from("pending_write_workflows").upsert({
    user_id: args.user_id,
    conversation_id: args.conversation_id,
    kind: args.workflow.kind,
    slots: args.workflow.slots,
    asked_slot: args.workflow.asked_slot,
    turns: args.workflow.turns,
    status: "open",
    expires_at: expires,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,conversation_id" });
}

export async function closeWorkflow(
  sb: any,
  args: { user_id: string; conversation_id: string; outcome: "completed" | "abandoned" },
): Promise<void> {
  await sb.from("pending_write_workflows")
    .update({ status: args.outcome, updated_at: new Date().toISOString() })
    .eq("user_id", args.user_id)
    .eq("conversation_id", args.conversation_id)
    .eq("status", "open");
}