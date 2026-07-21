// PolicyEngine — deterministic pre-LLM decisions.
// Currently owns the confirm/cancel interception, ownership guard and
// idempotency of receipts. Same logic that lived inline in the WhatsApp
// orchestrator; extracted so App and WhatsApp share one code path.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { findPending, type PendingRow } from "./PendingConfirmations.ts";
import { buildReceipt } from "./ReceiptBuilder.ts";
import type { ParsedIntent } from "../parser.ts";

export type PolicyDecision =
  | { kind: "pass" }
  | { kind: "reply"; body: string; replyKind: "info" | "receipt" | "cancelled" | "expired"; draft_id?: string; result?: unknown };

export async function evaluate(
  sb: SupabaseClient,
  args: { user_id: string; conversation_id: string; inbound_message_id: string | null; intent: ParsedIntent },
): Promise<PolicyDecision> {
  if (args.intent.kind !== "confirm" && args.intent.kind !== "cancel") return { kind: "pass" };
  const pending: PendingRow | null = await findPending(sb, args.conversation_id, args.user_id);

  if (args.intent.kind === "confirm") {
    if (!pending) {
      return { kind: "reply", replyKind: "info",
        body: "Não encontrei nada pendente para confirmar. Me conte a operação primeiro (ex.: “gastei 42,90 no almoço hoje”)." };
    }
    const { data: exec } = await sb.rpc("agent_execute_confirmation", {
      p_confirmation_id: pending.id, p_source_message_id: args.inbound_message_id,
    });
    const okExec = exec as { ok: boolean; result?: any; error?: string; idempotent?: boolean } | null;
    if (okExec?.ok) {
      const body = okExec.idempotent
        ? "Essa operação já havia sido confirmada. Está tudo certo por aqui. ✅"
        : buildReceipt(pending.kind as string, okExec.result);
      return { kind: "reply", replyKind: "receipt", body, draft_id: pending.id, result: okExec.result };
    }
    const body = okExec?.error === "expired"
      ? "Este pedido expirou. Envie de novo, por favor."
      : "Não consegui concluir a operação. Vamos tentar de novo?";
    return { kind: "reply", replyKind: okExec?.error === "expired" ? "expired" : "info", body };
  }

  // cancel
  if (pending) await sb.from("pending_confirmations").update({ status: "cancelled" }).eq("id", pending.id);
  return { kind: "reply", replyKind: "cancelled",
    body: "Combinado, cancelei este pedido. Se mudar de ideia, é só me contar de novo. 🙂" };
}
