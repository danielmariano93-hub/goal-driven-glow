// BulkEntry — registro em lote de vários lançamentos (ex.: fatura colada,
// lista de gastos, JSON extraído de um documento).
//
// Fluxo: detecta a lista → resolve cartão/conta → cria uma pending_confirmation
// de kind "bulk_transactions" → na confirmação, grava item a item via a RPC
// idempotente commit_movement (chave derivada do pending_id + índice).
// deno-lint-ignore-file no-explicit-any
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseBulkItems, sumItems, type BulkItem } from "../bulkParse.ts";
import { resolveCreditCardFull } from "../tools.ts";
import { extractSpans } from "../extract.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const CARD_KEYWORDS = /\b(cart[aã]o|fatura|itau|ita[uú]|nubank|bradesco|santander|inter|c6|xp|will|mercadopago|picpay|caixa)\b/i;

export type BulkDraft = {
  handled: true;
  reply: string;
  pending_id: string | null;
};

function today(): string {
  return new Date(new Date().getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

function summarize(items: BulkItem[], targetName: string, occurred_at: string): string {
  const preview = items.slice(0, 5).map(i => `• ${i.description} — ${BRL.format(i.amount)}`).join("\n");
  const rest = items.length > 5 ? `\n…e mais ${items.length - 5} lançamentos.` : "";
  return `Encontrei ${items.length} lançamentos (${BRL.format(sumItems(items))}) em ${targetName}, com data ${occurred_at}.\n${preview}${rest}`;
}

/** Tenta montar um rascunho em lote. Retorna null quando não é um caso de lote. */
export async function tryBulkDraft(sb: SupabaseClient, args: {
  user_id: string; conversation_id: string; text: string;
}): Promise<BulkDraft | null> {
  const parsed = parseBulkItems(args.text);
  if (parsed.items.length < 3) return null;

  const ctx = { sb, user_id: args.user_id, conversation_id: args.conversation_id } as any;
  const spans = extractSpans(args.text);
  const wantsCard = spans.payment_method === "credit_card" || CARD_KEYWORDS.test(args.text);

  let target: { kind: "credit_card" | "account"; id: string; name: string } | null = null;

  if (wantsCard) {
    const card = await resolveCreditCardFull(ctx, spans.card_hint ?? undefined);
    if (card.kind === "single") target = { kind: "credit_card", id: card.id, name: `cartão ${card.name}` };
    else if (card.kind === "multiple") {
      const names = card.choices.map(c => `• ${c.name}`).join("\n");
      return { handled: true, pending_id: null, reply: `Encontrei ${parsed.items.length} lançamentos (${BRL.format(sumItems(parsed.items))}). Em qual cartão eu registro?\n${names}` };
    } else if (card.available.length === 1) {
      target = { kind: "credit_card", id: card.available[0].id, name: `cartão ${card.available[0].name}` };
    }
  }

  if (!target) {
    const { data: accounts } = await sb.from("accounts").select("id,name")
      .eq("user_id", args.user_id).eq("active", true).order("created_at").limit(2);
    const list = (accounts ?? []) as Array<{ id: string; name: string }>;
    if (list.length === 0) {
      return { handled: true, pending_id: null, reply: "Você ainda não tem conta nem cartão cadastrado. Cadastre um e eu registro esses lançamentos em seguida." };
    }
    target = { kind: "account", id: list[0].id, name: list[0].name };
  }

  const occurred_at = spans.occurred_at ?? today();
  const payload = {
    items: parsed.items,
    occurred_at,
    target_kind: target.kind,
    target_id: target.id,
    target_name: target.name,
    total: sumItems(parsed.items),
  };
  const summary = summarize(parsed.items, target.name, occurred_at);

  const { data: id, error } = await sb.rpc("agent_upsert_draft", {
    p_user_id: args.user_id,
    p_conversation_id: args.conversation_id,
    p_kind: "bulk_transactions",
    p_payload: payload,
    p_summary: summary,
    p_ttl_minutes: 30,
  });
  if (error || !id) return { handled: true, pending_id: null, reply: "Consegui ler a lista, mas não guardei o rascunho. Pode reenviar?" };

  return {
    handled: true,
    pending_id: String(id),
    reply: `${summary}\n\nResponda *CONFIRMAR* para registrar tudo ou *CANCELAR* para descartar.`,
  };
}

/** Busca a pendência de lote ativa da conversa (se houver). */
export async function findBulkPending(sb: SupabaseClient, conversation_id: string, user_id: string, pending_id?: string | null) {
  let q = sb.from("pending_confirmations")
    .select("id, kind, payload, expires_at, status")
    .eq("conversation_id", conversation_id).eq("user_id", user_id)
    .eq("status", "pending").eq("kind", "bulk_transactions");
  if (pending_id) q = q.eq("id", pending_id);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as any) ?? null;
}

/** Executa a pendência de lote item a item (idempotente por chave). */
export async function executeBulkPending(sb: SupabaseClient, pending: any): Promise<{ ok: boolean; reply: string; inserted: number; failed: number }> {
  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await sb.from("pending_confirmations").update({ status: "expired" } as any).eq("id", pending.id).eq("status", "pending");
    return { ok: false, inserted: 0, failed: 0, reply: "Esse pedido expirou. Reenvie a lista, por favor." };
  }
  const payload = pending.payload ?? {};
  const items: BulkItem[] = Array.isArray(payload.items) ? payload.items : [];
  const occurred_at: string = payload.occurred_at ?? today();

  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const { error } = await sb.rpc("commit_movement", {
      p_idempotency_key: `bulk:${pending.id}:${i}`,
      p_type: "expense",
      p_amount: item.amount,
      p_occurred_at: occurred_at,
      p_status: "confirmed",
      p_payment_method: payload.target_kind === "credit_card" ? "credit_card" : "account",
      p_account_id: payload.target_kind === "account" ? payload.target_id : null,
      p_credit_card_id: payload.target_kind === "credit_card" ? payload.target_id : null,
      p_category_id: null,
      p_description: item.description,
      p_notes: null,
      p_origin: "agent",
    });
    if (error) { failed++; console.error("[bulk] item_failed", i, String(error.message).slice(0, 160)); }
    else inserted++;
  }

  await sb.from("pending_confirmations")
    .update({ status: failed === items.length ? "pending" : "confirmed" } as any)
    .eq("id", pending.id);

  const total = items.reduce((a, b) => a + b.amount, 0);
  if (inserted === 0) return { ok: false, inserted, failed, reply: "Não consegui registrar os lançamentos agora. Pode tentar de novo?" };
  const partial = failed > 0 ? ` (${failed} não entraram, me avise que eu tento de novo)` : "";
  return {
    ok: true, inserted, failed,
    reply: `Registrei ${inserted} lançamentos, somando ${BRL.format(total)}, em ${payload.target_name ?? "sua conta"}. ✅${partial}`,
  };
}
