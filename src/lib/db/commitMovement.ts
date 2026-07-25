// Wrapper cliente para a RPC public.commit_movement (SECURITY DEFINER, idempotente).
// Uso: em fluxos que precisem de idempotência forte (FastLog, confirmação do assessor,
// pagamento de fatura). O caminho de UI padrão (useSaveTransaction) permanece direto
// contra a tabela — este wrapper é aditivo.
import { supabase } from "@/integrations/supabase/client";

export type CommitMovementInput = {
  idempotency_key: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  occurred_at: string;
  status?: "confirmed" | "planned";
  payment_method?: string | null;
  account_id?: string | null;
  credit_card_id?: string | null;
  category_id?: string | null;
  description?: string | null;
  notes?: string | null;
  origin?: string | null;
};

export type CommitMovementResult = {
  transaction_id: string;
  reused: boolean;
};

export async function commitMovement(input: CommitMovementInput): Promise<CommitMovementResult> {
  const { data, error } = await (supabase.rpc as any)("commit_movement", {
    p_idempotency_key: input.idempotency_key,
    p_type: input.type,
    p_amount: input.amount,
    p_occurred_at: input.occurred_at,
    p_status: input.status ?? "confirmed",
    p_payment_method: input.payment_method ?? null,
    p_account_id: input.account_id ?? null,
    p_credit_card_id: input.credit_card_id ?? null,
    p_category_id: input.category_id ?? null,
    p_description: input.description ?? null,
    p_notes: input.notes ?? null,
    p_origin: input.origin ?? "app",
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.transaction_id) throw new Error("commit_movement_failed");
  return { transaction_id: String(row.transaction_id), reused: Boolean(row.reused) };
}
