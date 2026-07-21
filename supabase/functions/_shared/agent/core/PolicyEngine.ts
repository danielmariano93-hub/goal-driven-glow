// PolicyEngine — the single decision surface of the Agent Core.
//
// Two APIs coexist, both centralised here:
//
//   • `evaluate(sb, args)` — original Fase 1 API used by AgentCore for the
//     confirm/cancel interception. Preserved verbatim; existing behaviour
//     and tests stay green.
//
//   • `decideTurn(intent, ctx)` — expanded, purely functional Decision
//     classifier consumed by ActionPlanner. Returns an explicit label so
//     the whole "when to reply / when to run tools / when to fallback"
//     logic lives in one place instead of leaking into adapters.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { findLatestPendingOrExpired, findPending, type PendingRow } from "./PendingConfirmations.ts";
import { buildReceipt } from "./ReceiptBuilder.ts";
import type { ParsedIntent } from "../parser.ts";

// ---------------------------------------------------------------------------
// Confirm/cancel interception (Fase 1 API — unchanged)
// ---------------------------------------------------------------------------
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
      const latest = await findLatestPendingOrExpired(sb, args.conversation_id, args.user_id);
      if (latest && new Date(latest.expires_at).getTime() <= Date.now()) {
        await sb.from("pending_confirmations").update({ status: "expired" }).eq("id", latest.id).eq("status", "pending");
        return { kind: "reply", replyKind: "expired", body: "Este pedido expirou. Envie de novo, por favor." };
      }
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

// ---------------------------------------------------------------------------
// Turn-level Decision classifier (Fase 2 API — additive)
// ---------------------------------------------------------------------------
export type DecisionLabel =
  | "direct_reply"       // help, greeting, clarification
  | "run_tools"          // requires LLM+tool planning
  | "ask_confirmation"   // draft created, awaiting user CONFIRMAR
  | "cancel"             // explicit CANCELAR
  | "confirm"            // explicit CONFIRMAR of pending action
  | "need_context"       // intent is clear but slots missing
  | "reuse_context"      // last context can be reused (no reload)
  | "create_draft"       // deterministic draft can be built without LLM
  | "block"              // guardrail blocked (ownership, plausibility)
  | "interrupt"          // stop an ongoing flow
  | "fallback";          // deterministic fallback path

export type DecisionCtx = {
  hasPendingConfirmation: boolean;
  llmConfigured: boolean;
  hasPromptVersion: boolean;
  lastIntent?: string | null;
};

export type Decision = {
  label: DecisionLabel;
  rationale: string;
};

export function decideTurn(intent: ParsedIntent, ctx: DecisionCtx): Decision {
  const label = classify(intent, ctx);
  return { label, rationale: `intent=${intent.kind} pending=${ctx.hasPendingConfirmation} llm=${ctx.llmConfigured}` };
}

function classify(intent: ParsedIntent, ctx: DecisionCtx): DecisionLabel {
  if (intent.kind === "confirm") return "confirm";
  if (intent.kind === "cancel")  return "cancel";

  const canUseLLM = ctx.llmConfigured && ctx.hasPromptVersion;

  if (intent.kind === "transaction" || intent.kind === "transfer" || intent.kind === "goal_contribution") {
    return canUseLLM ? "run_tools" : "create_draft";
  }
  if (intent.kind === "query")   return canUseLLM ? "run_tools" : "fallback";
  if (intent.kind === "unknown") return canUseLLM ? "run_tools" : "direct_reply";
  return canUseLLM ? "run_tools" : "fallback";
}
