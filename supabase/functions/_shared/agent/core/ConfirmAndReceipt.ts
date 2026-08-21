// ConfirmAndReceipt (`nino_agent.v1`) — caminho ÚNICO de "confirmar e responder".
//
// Antes desta camada existiam quatro caminhos paralelos (tools.ts, AppAdapter,
// PolicyEngine e o resgate de rascunho no AgentCore). Cada um chamava o RPC de
// confirmação à mão e montava a resposta à mão — dois deles sem prova de
// escrita, e todos caindo em "Pronto, registrei. ✅" quando o kind era novo.
//
// Regra absoluta: SEM PROVA DE PERSISTÊNCIA, SEM RECIBO DE SUCESSO.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { executeConfirmation, type ConfirmationExecution, type PendingRow } from "./PendingConfirmations.ts";
import { buildActionReceipt, type ActionReceipt } from "./ReceiptBuilder.ts";
import { unprovenMessage } from "./PersistenceProof.ts";

export type ConfirmOutcome = {
  ok: boolean;
  /** Texto final pronto para o canal (recibo, idempotência ou falha honesta). */
  reply: string;
  reply_kind: "receipt" | "info" | "expired";
  receipt: ActionReceipt | null;
  execution: ConfirmationExecution | null;
  error: string | null;
  proven: boolean;
};

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return UUID_RX.test(s) ? s : null;
};

/**
 * Resolve os nomes que o recibo mostra (conta, cartão, categoria). Uma leitura
 * por entidade, sempre escopada ao usuário. Falha silenciosa: o recibo
 * simplesmente omite a linha em vez de quebrar.
 */
export async function resolveReceiptContext(
  sb: SupabaseClient,
  user_id: string,
  payload: any,
  result: any,
): Promise<{
  account_name: string | null; card_name: string | null; category_name: string | null;
  competence_date: string | null; due_date: string | null;
}> {
  const src = { ...(payload ?? {}), ...(result ?? {}) } as any;
  const accountId = asUuid(src.account_id ?? src.to_account_id ?? src.from_account_id);
  const cardId = asUuid(src.credit_card_id ?? src.card_id);
  const categoryId = asUuid(src.category_id);

  const [account, card, category] = await Promise.all([
    accountId
      ? sb.from("accounts").select("name").eq("id", accountId).eq("user_id", user_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    cardId
      ? sb.from("credit_cards").select("name").eq("id", cardId).eq("user_id", user_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    categoryId
      ? sb.from("categories").select("name").eq("id", categoryId).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]).catch(() => [{ data: null }, { data: null }, { data: null }] as any);

  return {
    account_name: ((account as any)?.data?.name as string | undefined) ?? null,
    card_name: ((card as any)?.data?.name as string | undefined) ?? null,
    category_name: ((category as any)?.data?.name as string | undefined) ?? null,
    competence_date: (src.competence_date ?? src.occurred_at ?? null) as string | null,
    due_date: (src.due_date ?? null) as string | null,
  };
}

/**
 * Executa a pendência e devolve o texto final. Único ponto autorizado a dizer
 * ao usuário que algo foi registrado.
 */
export async function confirmAndBuildReceipt(
  sb: SupabaseClient,
  pending: Pick<PendingRow, "id" | "kind" | "user_id"> & { payload?: unknown },
  opts: { source_message_id?: string | null } = {},
): Promise<ConfirmOutcome> {
  const execution = await executeConfirmation(sb, pending, opts);

  if (!execution.ok) {
    const expired = execution.error === "expired" || String(execution.error ?? "").includes("expired");
    return {
      ok: false,
      reply: expired
        ? "Este pedido expirou. Envie de novo, por favor."
        : "Não consegui concluir a operação — ela NÃO foi registrada. Quer tentar de novo?",
      reply_kind: expired ? "expired" : "info",
      receipt: null, execution, error: execution.error, proven: false,
    };
  }

  if (!execution.proof.proven) {
    return {
      ok: false, reply: unprovenMessage(), reply_kind: "info", receipt: null,
      execution, error: `persistence_unproven:${execution.proof.reason ?? "unknown"}`, proven: false,
    };
  }

  if (execution.idempotent) {
    return {
      ok: true, reply: "Essa operação já havia sido confirmada. Está tudo certo por aqui. ✅",
      reply_kind: "receipt", receipt: null, execution, error: null, proven: true,
    };
  }

  const context = await resolveReceiptContext(sb, pending.user_id, pending.payload, execution.result);
  const receipt = buildActionReceipt(pending.kind, { ...(pending.payload as any ?? {}), ...(execution.result ?? {}) }, context);
  return { ok: true, reply: receipt.text, reply_kind: "receipt", receipt, execution, error: null, proven: true };
}
