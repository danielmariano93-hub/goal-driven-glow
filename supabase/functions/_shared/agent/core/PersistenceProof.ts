// PersistenceProof (`nino_agent.v1`) — prova de escrita antes do recibo.
//
// Regra do agente autônomo: o Nino só afirma "registrado" depois de LER de
// volta a linha que ele diz ter criado/alterado. Se a leitura não confirmar,
// a resposta deixa de ser recibo e passa a ser honesta ("não consegui salvar").
//
// Determinístico e testável: dado o `kind` da confirmação e o resultado do RPC,
// o módulo sabe qual tabela e qual id ler.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type ProofTarget = { table: string; id: string } | null;

export type PersistenceProof = {
  proven: boolean;
  /** Motivo quando não provado (auditoria/telemetria). */
  reason: string | null;
  table: string | null;
  id: string | null;
};

/** Mapa canônico kind → tabela onde a escrita precisa aparecer. */
const TABLE_BY_KIND: Record<string, string> = {
  transaction: "transactions",
  bulk_transactions: "transactions",
  transaction_update: "transactions",
  transaction_delete: "transactions",
  transfer: "transactions",
  goal: "goals",
  goal_contribution: "goal_contributions",
  shared_goal_create: "shared_goals",
  shared_goal_contribution: "shared_goal_contributions",
  shared_expense: "shared_expenses",
  debt: "debts",
  credit_card_payment: "credit_card_payments",
  emotional_checkin: "emotional_checkins",
};

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extrai o id da entidade escrita a partir do resultado do RPC. */
export function proofTarget(kind: string, result: unknown): ProofTarget {
  const table = TABLE_BY_KIND[String(kind ?? "").trim()];
  if (!table) return null;
  const r = (result ?? {}) as any;
  const candidates = [
    r.id, r.transaction_id, r.goal_id, r.contribution_id, r.debt_id,
    r.shared_expense_id, r.shared_goal_id, r.payment_id, r.checkin_id,
    Array.isArray(r.ids) ? r.ids[0] : null,
    Array.isArray(r.transactions) ? (r.transactions[0]?.id ?? null) : null,
  ];
  const id = candidates.map((c) => (typeof c === "string" ? c.trim() : "")).find((c) => UUID_RX.test(c));
  return id ? { table, id } : null;
}

/**
 * Lê de volta a linha escrita. Nunca lança: qualquer falha vira `proven:false`
 * com motivo, para que a camada de resposta escolha uma frase honesta.
 */
export async function verifyPersisted(
  sb: SupabaseClient,
  args: { kind: string; user_id: string; result: unknown; idempotent?: boolean },
): Promise<PersistenceProof> {
  const target = proofTarget(args.kind, args.result);
  if (!target) {
    // Sem id legível não há como provar — mas também não há como negar quando o
    // RPC foi idempotente (a escrita já existia em turno anterior).
    return {
      proven: !!args.idempotent,
      reason: args.idempotent ? null : "no_proof_target",
      table: TABLE_BY_KIND[String(args.kind ?? "")] ?? null,
      id: null,
    };
  }
  try {
    let q = sb.from(target.table).select("id").eq("id", target.id).limit(1);
    // Toda tabela do mapa é escopada por usuário; o filtro impede provar a
    // escrita de outra pessoa.
    q = (q as any).eq("user_id", args.user_id);
    const { data, error } = await (q as any).maybeSingle();
    if (error) return { proven: false, reason: `read_back_failed:${error.message}`, ...target };
    if (!data) return { proven: false, reason: "row_not_found", ...target };
    return { proven: true, reason: null, ...target };
  } catch (e) {
    return { proven: false, reason: `read_back_threw:${String((e as Error).message).slice(0, 120)}`, ...target };
  }
}

/** Frase honesta quando a escrita não pôde ser provada. */
export function unprovenMessage(): string {
  return "Não consegui confirmar o registro no seu histórico agora. Não vou dizer que salvei sem ter certeza — pode tentar de novo em instantes? 💛";
}
