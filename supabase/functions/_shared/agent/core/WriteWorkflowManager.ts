// WriteWorkflowManager (`nino_write_workflow.v1`)
//
// Fluxo de ESCRITA multi-turno durável. A causa-raiz: a continuação de escrita
// era heurística (reconstrução de mensagens curtas pelo histórico) e o estado
// vivia em `agent_sessions.state` (30 min) ou no draft (15 min). No WhatsApp,
// onde o usuário responde horas depois, o fluxo morria e a resposta caía num
// `transaction_entry` genérico — perdendo o que ele já tinha dito.
//
// Aqui o fluxo é um REGISTRO: intenção declarada, slots coletados, slots que
// faltam e próxima pergunta. Um fluxo aberto por conversa (índice único
// parcial). Confirmação continua idempotente em `pending_confirmations`; este
// módulo não escreve dinheiro — só carrega a intenção até estar completa.
// deno-lint-ignore-file no-explicit-any

/** Nomes canônicos das tools de escrita — nada de rótulo inventado. */
export const WRITE_WORKFLOW_KINDS = [
  "create_transaction_draft",
  "create_transfer_draft",
  "pay_credit_card_bill_draft",
  "create_split_expense_draft",
  "create_goal_draft",
  "add_goal_contribution_draft",
  "create_debt_draft",
] as const;
export type WriteWorkflowKind = typeof WRITE_WORKFLOW_KINDS[number];

/** Slots OBRIGATÓRIOS por fluxo — espelham o schema real de cada tool. */
export const REQUIRED_SLOTS: Record<WriteWorkflowKind, string[]> = {
  create_transaction_draft: ["type", "amount"],
  create_transfer_draft: ["amount", "from_account", "to_account"],
  pay_credit_card_bill_draft: ["amount", "card"],
  create_split_expense_draft: ["title", "total", "participants"],
  create_goal_draft: ["name", "target_amount"],
  add_goal_contribution_draft: ["goal", "amount"],
  create_debt_draft: ["name", "original_amount"],
};

const SLOT_QUESTION: Record<string, string> = {
  type: "É entrada ou saída?",
  amount: "Qual foi o valor?",
  from_account: "Sai de qual conta?",
  to_account: "Vai para qual conta?",
  card: "Qual cartão?",
  title: "Qual o nome desse rolê?",
  total: "Qual o valor total?",
  participants: "Quem participou?",
  name: "Qual o nome?",
  target_amount: "Qual o valor da meta?",
  goal: "Para qual meta?",
  original_amount: "Qual o valor original da dívida?",
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

/** Limite de idas e voltas: fluxo que não fecha não fica pedindo para sempre. */
export const MAX_WORKFLOW_TURNS = 6;

export function missingSlots(workflow: WriteWorkflow): string[] {
  return (REQUIRED_SLOTS[workflow.kind] ?? []).filter((slot) => {
    const value = workflow.slots?.[slot];
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  });
}

/** Próximo passo determinístico do fluxo — nunca decidido pela LLM. */
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

/** Aplica a resposta do usuário no slot que o Nino perguntou. */
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

// ---------------------------------------------------------------------------
// Persistência (`pending_write_workflows`) — TTL de 24h, um fluxo aberto por
// conversa. Fail-open na leitura: erro de banco não pode travar o turno.
// ---------------------------------------------------------------------------

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
