// Deterministic fallback path — identical semantics to the previous
// fallbackTurn() inside orchestrator.ts; extracted verbatim so AgentCore
// has a single source of truth for the non-LLM branch used by both
// channels.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { interpret, type ParsedIntent } from "../parser.ts";
import { extractSpans } from "../extract.ts";
import {
  create_transaction_draft, create_transfer_draft,
  add_goal_contribution_draft,
  get_financial_summary, list_recent_transactions,
  type ToolContext,
} from "../tools.ts";

const NUM_BR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export type FallbackOutcome = {
  reply: string;
  draft_id?: string;
  kind: "info" | "question" | "draft";
};

export async function deterministicFallback(
  sb: SupabaseClient,
  input: { user_id: string; conversation_id: string; text: string },
): Promise<FallbackOutcome> {
  const intent: ParsedIntent = interpret(input.text);
  const ctx: ToolContext = { sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: input.text };

  const spans = extractSpans(input.text);
  if (spans.amount != null && spans.amount > 0 && spans.description && (spans.payment_method || spans.card_hint || spans.account_hint)) {
    const r = await create_transaction_draft(ctx, {
      type: "expense",
      amount: spans.amount,
      account: spans.payment_method === "account" ? (spans.account_hint ?? "") : undefined,
      credit_card: spans.payment_method === "credit_card" ? (spans.card_hint ?? "") : undefined,
      installments_total: spans.installments_total ?? undefined,
      category: spans.category_hint ?? undefined,
      occurred_at: spans.occurred_at ?? undefined,
      description: spans.description,
    });
    if (r.ok) return { reply: `${(r.result as any).summary}\nResponda *CONFIRMAR* para registrar ou *CANCELAR* para descartar.`, draft_id: (r.result as any).draft_id, kind: "draft" };
    if (r.error === "account_not_found") return { reply: "Em qual conta eu registro? (ex.: Nubank, Itaú, Carteira)", kind: "question" };
    if (r.error === "card_not_found") return { reply: "Em qual cartão eu registro?", kind: "question" };
  }

  if (intent.kind === "query") {
    if (intent.topic === "summary") {
      const r = await get_financial_summary(ctx);
      if (r.ok) {
        const s = r.result as { income: number; expense: number; net: number };
        return { reply: `Neste mês: entradas ${NUM_BR.format(s.income)}, saídas ${NUM_BR.format(s.expense)}, saldo do período ${NUM_BR.format(s.net)}.`, kind: "info" };
      }
    }
    if (intent.topic === "recent") {
      const r = await list_recent_transactions(ctx, { limit: 5 });
      const rows = (r.ok ? r.result : []) as any[];
      if (rows.length === 0) return { reply: "Ainda não há lançamentos por aqui.", kind: "info" };
      const lines = rows.map(x => `• ${x.occurred_at} · ${x.type === "expense" ? "-" : "+"}${NUM_BR.format(Number(x.amount))}${x.description ? ` · ${x.description}` : ""}`);
      return { reply: "Seus últimos lançamentos:\n" + lines.join("\n"), kind: "info" };
    }
    if (intent.topic === "before_spending" && intent.amount) {
      // O parser legado não extrai data/categoria/meio de pagamento. Nunca
      // execute uma simulação parcial com defaults silenciosos; o roteador de
      // capacidades determinístico conclui o cálculo quando os slots existem.
      return { reply: "Em qual data você pretende fazer esse gasto? Se quiser, informe também categoria e meio de pagamento.", kind: "question" };
    }
  }

  if (intent.kind === "transaction") {
    const r = await create_transaction_draft(ctx, {
      type: intent.type, amount: intent.amount,
      account: intent.account_hint ?? "",
      category: intent.category_hint,
      occurred_at: intent.occurred_at,
      description: intent.description,
    });
    if (!r.ok) {
      if (r.error === "account_not_found") {
        return { reply: "Em qual conta eu registro? (ex.: Nubank, Itaú, Carteira)", kind: "question" };
      }
      return { reply: "Não consegui entender direito. Pode repetir?", kind: "info" };
    }
    return { reply: `${(r.result as any).summary}\nResponda *CONFIRMAR* para registrar ou *CANCELAR* para descartar.`, draft_id: (r.result as any).draft_id, kind: "draft" };
  }

  if (intent.kind === "transfer") {
    const r = await create_transfer_draft(ctx, {
      amount: intent.amount, from_account: intent.from_hint ?? "", to_account: intent.to_hint ?? "",
      occurred_at: intent.occurred_at,
    });
    if (!r.ok) return { reply: "Escreva assim: “transferir 100 de Nubank para Itaú”.", kind: "question" };
    return { reply: `${(r.result as any).summary}\nResponda *CONFIRMAR* ou *CANCELAR*.`, draft_id: (r.result as any).draft_id, kind: "draft" };
  }

  if (intent.kind === "goal_contribution" && intent.goal_hint) {
    const r = await add_goal_contribution_draft(ctx, { goal: intent.goal_hint, amount: intent.amount, occurred_at: intent.occurred_at });
    if (r.ok) return { reply: `${(r.result as any).summary}\nResponda *CONFIRMAR* ou *CANCELAR*.`, draft_id: (r.result as any).draft_id, kind: "draft" };
  }

  return {
    reply: "Não consegui identificar com segurança o que você quer fazer. Posso consultar seu saldo e metas, analisar padrões de gastos, simular uma compra, registrar um lançamento ou conduzir a divisão de um rolê. Reformule em uma frase direta e eu continuo sem alterar nada até entender.",
    kind: "info",
  };
}
