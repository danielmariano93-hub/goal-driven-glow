// Lookup helper for the single pending confirmation per (conversation,user).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { verifyPersisted, type PersistenceProof } from "./PersistenceProof.ts";

export type PendingRow = {
  id: string;
  kind: string;
  payload: unknown;
  summary_text: string;
  status: string;
  expires_at: string;
  user_id: string;
  conversation_id: string;
};

/** Canonical executor selection used by text confirmation, app buttons and
 * tool-driven confirmation. Category Truth V2 routes transaction drafts to a
 * dedicated RPC that preserves explicit-category provenance instead of relying
 * on the legacy origin=manual heuristic. */
export function confirmationExecutor(kind: string): string {
  if (kind === "shared_expense") return "agent_execute_shared_expense_confirmation";
  if (kind === "transaction") return "agent_execute_transaction_confirmation_v2";
  return "agent_execute_confirmation";
}

export async function findPending(
  sb: SupabaseClient,
  conversation_id: string,
  user_id: string,
): Promise<PendingRow | null> {
  const { data } = await sb.from("pending_confirmations")
    .select("id, kind, payload, summary_text, status, expires_at, user_id, conversation_id")
    .eq("conversation_id", conversation_id)
    .eq("user_id", user_id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return (data as PendingRow | null) ?? null;
}

export async function findLatestPendingOrExpired(
  sb: SupabaseClient,
  conversation_id: string,
  user_id: string,
): Promise<PendingRow | null> {
  const { data } = await sb.from("pending_confirmations")
    .select("id, kind, payload, summary_text, status, expires_at, user_id, conversation_id")
    .eq("conversation_id", conversation_id)
    .eq("user_id", user_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PendingRow | null) ?? null;
}

export type ConfirmationExecution = {
  ok: boolean;
  error: string | null;
  idempotent: boolean;
  result: any;
  /** Prova de leitura pós-escrita (nino_agent.v1). */
  proof: PersistenceProof;
};

/**
 * Execução canônica de uma pendência. ÚNICO caminho autorizado para chamar os
 * RPCs de confirmação: centraliza os nomes de parâmetro (`p_confirmation_id`,
 * `p_source_message_id`) e sempre devolve prova de escrita lida de volta.
 */
export async function executeConfirmation(
  sb: SupabaseClient,
  pending: Pick<PendingRow, "id" | "kind" | "user_id">,
  opts: { source_message_id?: string | null } = {},
): Promise<ConfirmationExecution> {
  const empty: PersistenceProof = { proven: false, reason: "not_executed", table: null, id: null };
  const { data, error } = await sb.rpc(confirmationExecutor(pending.kind), {
    p_confirmation_id: pending.id,
    p_source_message_id: opts.source_message_id ?? null,
  });
  if (error) return { ok: false, error: `confirmation_rpc_failed:${error.message}`, idempotent: false, result: null, proof: empty };
  const res = (data ?? null) as { ok?: boolean; result?: any; error?: string; idempotent?: boolean } | null;
  if (!res?.ok) return { ok: false, error: res?.error ?? "confirmation_failed", idempotent: false, result: res?.result ?? null, proof: empty };
  const idempotent = !!res.idempotent;
  const proof = await verifyPersisted(sb, {
    kind: pending.kind, user_id: pending.user_id, result: res.result, idempotent,
  });
  return { ok: true, error: null, idempotent, result: res.result ?? null, proof };
}
