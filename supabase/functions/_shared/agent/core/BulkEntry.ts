// BulkEntry — entrada em lote no chat (lista colada, JSON com dezenas de
// lançamentos, fatura copiada).
//
// A partir do pipeline único de importação, este módulo NÃO grava mais item a
// item por conta própria. Ele apenas:
//   1. normaliza o lote com `parseBatch` (data/natureza/destino por item);
//   2. estagia em `document_imports` + `extracted_items` com deduplicação
//      contra o histórico já registrado (`stageBatch`);
//   3. cria a pendência de confirmação com a PRÉVIA (novos / já registrados /
//      possíveis duplicados / revisão);
//   4. na confirmação, chama `confirmBatch` (RPC idempotente) e devolve o
//      relatório final da importação.
// Assim chat, PDF, imagem, CSV/OFX e WhatsApp compartilham exatamente as mesmas
// regras de normalização, duplicidade e gravação.
// deno-lint-ignore-file no-explicit-any
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseBatch, sumBatch } from "../../import/parseBatch.ts";
import { stageBatch, type BatchTarget } from "../../import/stage.ts";
import { confirmBatch, formatPreview, formatReport } from "../../import/commit.ts";
import { resolveCreditCardFull } from "../tools.ts";
import { extractSpans } from "../extract.ts";
import { buildAssessorLink } from "../../messaging/appUrl.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const CARD_KEYWORDS = /\b(cart[aã]o|fatura|itau|ita[uú]|nubank|bradesco|santander|inter|c6|xp|will|mercadopago|picpay|caixa)\b/i;

export type BulkDraft = {
  handled: true;
  reply: string;
  pending_id: string | null;
};

/** Tenta montar um rascunho em lote. Retorna null quando não é um caso de lote. */
export async function tryBulkDraft(sb: SupabaseClient, args: {
  user_id: string; conversation_id: string; text: string; source?: "app" | "whatsapp";
}): Promise<BulkDraft | null> {
  const parsed = parseBatch(args.text);
  if (parsed.items.length < 3) return null;

  const ctx = { sb, user_id: args.user_id, conversation_id: args.conversation_id } as any;
  const spans = extractSpans(args.text);
  const wantsCard = spans.payment_method === "credit_card"
    || parsed.items.some((item) => item.payment_method === "credit_card" || item.card_hint)
    || CARD_KEYWORDS.test(args.text);

  let target: BatchTarget | null = null;

  if (wantsCard) {
    const cardHint = spans.card_hint ?? parsed.items.find((i) => i.card_hint)?.card_hint ?? undefined;
    const card = await resolveCreditCardFull(ctx, cardHint ?? undefined);
    if (card.kind === "single") target = { kind: "credit_card", id: card.id, name: `cartão ${card.name}` };
    else if (card.kind === "multiple") {
      const names = card.choices.map((c: any) => `• ${c.name}`).join("\n");
      return {
        handled: true,
        pending_id: null,
        reply: `Encontrei ${parsed.items.length} lançamentos (${BRL.format(sumBatch(parsed.items))}). Em qual cartão eu registro?\n${names}`,
      };
    } else if (card.available.length === 1) {
      target = { kind: "credit_card", id: card.available[0].id, name: `cartão ${card.available[0].name}` };
    }
  }

  if (!target) {
    const { data: accounts } = await sb.from("accounts").select("id,name")
      .eq("user_id", args.user_id).eq("active", true).order("created_at").limit(2);
    const list = (accounts ?? []) as Array<{ id: string; name: string }>;
    if (list.length === 0) {
      return {
        handled: true,
        pending_id: null,
        reply: "Você ainda não tem conta nem cartão cadastrado. Cadastre um e eu registro esses lançamentos em seguida.",
      };
    }
    target = { kind: "account", id: list[0].id, name: list[0].name };
  }

  let staged;
  try {
    staged = await stageBatch(sb, {
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      source: args.source ?? "app",
      items: parsed.items,
      target,
      raw_text: args.text,
    });
  } catch (error) {
    console.error("[bulk] stage_failed", String((error as Error).message).slice(0, 200));
    return { handled: true, pending_id: null, reply: "Consegui ler a lista, mas não guardei o rascunho. Pode reenviar?" };
  }

  const dates = parsed.items.map((i) => i.occurred_at).filter(Boolean).sort() as string[];
  const periodLabel = dates.length > 1 && dates[0] !== dates[dates.length - 1]
    ? `${dates[0]} a ${dates[dates.length - 1]}`
    : dates[0] ?? null;

  const netTotal = staged.total_expense - staged.total_income;
  const summary = formatPreview(staged.counters, {
    targetName: target.name,
    netTotal,
    periodLabel,
    reviewLink: buildAssessorLink({ APP_PUBLIC_URL: Deno.env.get("APP_PUBLIC_URL") }, "batch_review"),
  });

  const payload = {
    document_id: staged.document_id,
    item_ids: staged.ready_item_ids,
    counters: staged.counters,
    target_kind: target.kind,
    target_id: target.id,
    target_name: target.name,
    total: netTotal,
  };

  const { data: id, error } = await sb.rpc("agent_upsert_draft", {
    p_user_id: args.user_id,
    p_conversation_id: args.conversation_id,
    p_kind: "bulk_transactions",
    p_payload: payload,
    p_summary: summary,
    p_ttl_minutes: 60,
  });
  if (error || !id) {
    return { handled: true, pending_id: null, reply: "Consegui ler a lista, mas não guardei o rascunho. Pode reenviar?" };
  }

  return { handled: true, pending_id: String(id), reply: summary };
}

/** Busca a pendência de lote ativa da conversa (se houver). */
export async function findBulkPending(sb: SupabaseClient, conversation_id: string, user_id: string, pending_id?: string | null) {
  let q = sb.from("pending_confirmations")
    .select("id, user_id, kind, payload, expires_at, status")
    .eq("conversation_id", conversation_id).eq("user_id", user_id)
    .eq("status", "pending").eq("kind", "bulk_transactions");
  if (pending_id) q = q.eq("id", pending_id);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as any) ?? null;
}

/** Confirma o lote estagiado (idempotente) e devolve o relatório da importação. */
export async function executeBulkPending(sb: SupabaseClient, pending: any): Promise<{
  ok: boolean; reply: string; inserted: number; failed: number;
}> {
  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await sb.from("pending_confirmations").update({ status: "expired" } as any).eq("id", pending.id).eq("status", "pending");
    return { ok: false, inserted: 0, failed: 0, reply: "Esse pedido expirou. Reenvie a lista, por favor." };
  }

  const payload = pending.payload ?? {};
  const documentId = payload.document_id ? String(payload.document_id) : null;
  if (!documentId) {
    // Rascunhos legados (formato antigo, sem trilha de importação) não têm
    // deduplicação: pedimos o reenvio em vez de gravar às cegas.
    await sb.from("pending_confirmations").update({ status: "expired" } as any).eq("id", pending.id);
    return {
      ok: false, inserted: 0, failed: 0,
      reply: "Esse rascunho é de um formato antigo e não passou pela checagem de duplicidade. Reenvie a lista que eu processo com a conferência completa.",
    };
  }

  const report = await confirmBatch(sb, {
    user_id: pending.user_id,
    document_id: documentId,
    item_ids: Array.isArray(payload.item_ids) && payload.item_ids.length > 0 ? payload.item_ids : null,
  });

  await sb.from("pending_confirmations")
    .update({ status: report.imported > 0 ? "confirmed" : "pending" } as any)
    .eq("id", pending.id);

  const reply = formatReport(report, payload.target_name ?? "sua conta");
  return { ok: report.imported > 0, inserted: report.imported, failed: report.failed, reply };
}
