// comms_contract.v2 — contrato de schema do subsistema de comunicação.
// Cada coluna listada aqui é lida ou escrita por código de produção. O teste
// de contrato falha se alguma delas não existir nas migrations, evitando
// regressões como a do motor proativo que consultava `agent_runs.created_at`.

export const COMMUNICATION_SCHEMA_CONTRACT: Record<string, string[]> = {
  reminder_jobs: [
    "kind",
    "scheduled_for",
    "status",
    "delivery_status",
    "idempotency_key",
    "policy_version",
    "outbound_message_id",
    "superseded_by",
    "delivered_at",
    "read_at",
    "cancel_reason",
    "lease_expires_at",
  ],
  outbound_messages: [
    "status",
    "next_attempt_at",
    "idempotency_key",
    "context_type",
    "context_id",
    "provider_message_id",
    "last_error",
  ],
  notifications: ["dedup_key", "logical_dedup_key", "action_url", "type"],
  communication_deliveries: ["dedup_key", "logical_dedup_key", "block_context", "suggestion_id", "channel"],
  pending_proactive_suggestions: [
    "dedup_key",
    "logical_dedup_key",
    "channel_ready",
    "next_attempt_at",
    "defer_reason",
    "status",
  ],
  user_insights: ["dedup_key", "logical_dedup_key", "family", "prompt_version", "expires_at"],
  job_heartbeats: ["job_key", "last_run_at", "last_ok", "processed", "failed", "stages"],
  agent_runs: ["started_at", "status"],
  shared_expense_participants: [
    "communication_status",
    "last_reminded_at",
    "reminder_count",
    "delivered_count",
    "last_delivered_at",
  ],
};

/** Funções de banco que o código de produção invoca por RPC. */
export const COMMUNICATION_RPC_CONTRACT = [
  "record_job_stages",
  "reconcile_split_reminder_jobs",
  "apply_split_reminder_policy",
  "schedule_split_due_reminders",
  "whatsapp_send_dispatch_tick",
  "admin_reconcile_split_reminders",
];
