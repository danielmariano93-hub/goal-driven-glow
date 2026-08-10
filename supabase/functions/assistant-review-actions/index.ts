// Edge Function: assistant-review-actions
// POST body:
//   { action:'list', document_id }
//   { action:'update', item_id, patch:{...} }
//   { action:'ignore', item_id }
//   { action:'confirm', document_id, item_ids:[...] }
//   { action:'cancel', document_id }
//   { action:'reconcile', document_id, account_id }
//   { action:'rollback', document_id }
//   { action:'reprocess-rejected', document_id, reason_codes?:[...] }
//   { action:'set-source-context', document_id, account_id?, credit_card_id?, propagate?:boolean }
//   { action:'update-document', document_id, patch:{ invoice_total?, invoice_previous_balance?, invoice_due_date?, invoice_closing_date?, invoice_competence_month? } }
//   { action:'learn-alias', alias_key, friendly_name, category_id? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fail } from "../_shared/http.ts";
import { storageMerchantKey } from "../_shared/categorization/normalize.ts";

const FN = "assistant-review-actions";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_PATCH_KEYS = new Set([
  "description", "friendly_description", "amount", "occurred_at", "category_id", "account_id",
  "credit_card_id", "payment_method", "installments_total", "installment_number",
  "purchase_date", "competence_date", "historical_installments_paid_assumption",
  "statement_item_kind", "installment_inferred",
]);
const ALLOWED_DOCUMENT_PATCH_KEYS = new Set([
  "invoice_total", "invoice_previous_balance", "invoice_due_date", "invoice_closing_date",
  "invoice_competence_month", "invoice_card_last4",
]);

async function getUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error) return null;
  return data.user;
}

function aliasKey(raw: string): string {
  return storageMerchantKey(raw);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", { status: 405, functionName: FN });

  const user = await getUser(req);
  if (!user) return fail("unauthorized", { status: 401, functionName: FN });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("invalid_json", { status: 400, functionName: FN }); }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = String(body.action ?? "");

  if (action === "list") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    const { data: doc } = await sb.from("document_imports").select("*").eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!doc) return fail("not_found", { status: 404, functionName: FN });
    const [{ data: items }, { data: fragments }, { data: rejections }] = await Promise.all([
      sb.from("extracted_items").select("*").eq("document_id", document_id).eq("user_id", user.id).order("idx"),
      sb.from("document_fragments").select("fragment_index,total_fragments,page_start,page_end,status,attempts,items_found,duplicates_found,error_code,partial,extraction_ms,updated_at").eq("document_id", document_id).eq("user_id", user.id).order("fragment_index"),
      sb.from("document_item_rejections").select("id,item_index,reason_code,reason_field,reason_message,description_excerpt,created_at").eq("document_id", document_id).eq("user_id", user.id).order("item_index"),
    ]);
    return json({ ok: true, document: doc, items: items ?? [], fragments: fragments ?? [], rejections: rejections ?? [] });
  }

  if (action === "update") {
    const item_id = String(body.item_id ?? "");
    const patch = (body.patch ?? {}) as Record<string, unknown>;
    if (!item_id) return fail("missing_item_id", { status: 400, functionName: FN });
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!ALLOWED_PATCH_KEYS.has(k)) continue;
      clean[k] = v;
    }
    // friendly_description e description caminham juntos: friendly é o rótulo
    // amigável mostrado; description é o que gravamos na transação. Não
    // sobrescrevemos bank_description/raw_description aqui — o literal é preservado.
    if ("friendly_description" in clean && !("description" in clean)) {
      clean.description = clean.friendly_description;
    }
    if (Object.keys(clean).length === 0) return fail("empty_patch", { status: 400, functionName: FN });
    // Marca a edição manual: essa flag é a fonte de verdade para o pipeline
    // de reprocessamento — categoria/valor/descrição escolhidos pelo usuário
    // nunca são sobrescritos por regras, aliases, LLM ou reenriquecimento.
    (clean as Record<string, unknown>).user_edited_at = new Date().toISOString();
    const { data, error } = await sb.from("extracted_items").update(clean).eq("id", item_id).eq("user_id", user.id).select().maybeSingle();
    if (error) return fail("update_failed", { status: 400, functionName: FN, details: { details: error.message} });
    if (!data) return fail("not_found", { status: 404, functionName: FN });
    return json({ ok: true, item: data });
  }

  if (action === "ignore") {
    const item_id = String(body.item_id ?? "");
    if (!item_id) return fail("missing_item_id", { status: 400, functionName: FN });
    const { data, error } = await sb.from("extracted_items").update({ status: "ignored" }).eq("id", item_id).eq("user_id", user.id).select().maybeSingle();
    if (error) return fail("update_failed", { status: 400, functionName: FN, details: { details: error.message} });
    if (!data) return fail("not_found", { status: 404, functionName: FN });
    return json({ ok: true, item: data });
  }

  if (action === "confirm") {
    const document_id = String(body.document_id ?? "");
    const item_ids = Array.isArray(body.item_ids) ? (body.item_ids as string[]) : [];
    if (!document_id || item_ids.length === 0) return fail("missing_fields", { status: 400, functionName: FN });

    // Extrato bancário e fatura têm contratos diferentes. Extrato precisa de
    // conta resolvida ANTES de gravar: sem isso o item vira despesa órfã e o
    // saldo bancário nunca fecha (causa raiz da divergência de caixa).
    const { data: docRow } = await sb.from("document_imports")
      .select("id, document_kind, source_account_id, statement_closing_balance, statement_balance_date")
      .eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!docRow) return fail("not_found", { status: 404, functionName: FN });
    const isStatement = String(docRow.document_kind ?? "") === "statement";
    if (isStatement && !docRow.source_account_id) {
      return fail("needs_account_selection", {
        status: 409, functionName: FN, details: { document_id },
        message: "Antes de salvar, escolha a conta bancária deste extrato. Nada foi gravado.",
      });
    }

    const idempotencyKey = String(body.idempotency_key ?? `${isStatement ? "statement" : "invoice"}:${document_id}:${[...item_ids].sort().join(",")}`);
    const { data, error } = await userClient.rpc("confirm_invoice_import_atomic", {
      p_document_id: document_id,
      p_item_ids: item_ids,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      // Postgres returns the validation/finalization JSON in details. Preserve
      // it so the UI can explain the exact correction without losing edits.
      let diagnostic: Record<string, unknown> | null = null;
      try { diagnostic = error.details ? JSON.parse(error.details) : null; } catch { diagnostic = null; }
      const difference = Math.abs(Number(diagnostic?.difference ?? diagnostic?.gap_amount ?? 0));
      const money = difference.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const userMessage = error.message.includes("invoice_not_reconciled")
        ? `A fatura ainda não fecha${difference ? `: diferença de ${money}` : ""}. Suas edições continuam salvas; corrija a conciliação e tente novamente.`
        : "Nada foi gravado. Suas edições continuam salvas e você pode tentar novamente.";
      return fail("atomic_confirmation_failed", { status: 422, functionName: FN, details: { reason: error.message, result: diagnostic }, message: userMessage });
    }

    // Guarda anti-perda-silenciosa: item confirmado sem transação no ledger é
    // bug contábil. Detectamos aqui e devolvemos para revisão em vez de mentir.
    const { data: orphans } = await sb.from("extracted_items")
      .select("id, description, amount, occurred_at")
      .eq("document_id", document_id).eq("user_id", user.id)
      .eq("status", "confirmed").is("transaction_id", null);
    if (orphans && orphans.length > 0) {
      await sb.from("extracted_items").update({ status: "needs_review" })
        .in("id", orphans.map((o) => String(o.id)));
    }

    // Estorno vira crédito da categoria original (refund_link.v1). Sem vínculo,
    // Transporte segue inflado e o abatimento cai numa categoria genérica.
    const { data: refundLink } = await userClient.rpc("link_document_refunds", {
      p_document_id: document_id,
    });

    let reconciliation: unknown = null;
    if (isStatement) {
      const { data: rec, error: recErr } = await userClient.rpc("reconcile_account_statement", {
        p_document_id: document_id,
        p_account_id: docRow.source_account_id,
      });
      reconciliation = recErr ? { ok: false, error: recErr.message } : rec;
    }

    return json({
      ok: true,
      result: data,
      reconciliation,
      refund_link: refundLink ?? null,
      recovered_orphans: orphans?.length ?? 0,
    });

  }


  if (action === "update-document") {
    const document_id = String(body.document_id ?? "");
    const patch = (body.patch ?? {}) as Record<string, unknown>;
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (ALLOWED_DOCUMENT_PATCH_KEYS.has(key)) clean[key] = value;
    }
    if ("invoice_total" in clean) {
      const total = Number(clean.invoice_total);
      if (!Number.isFinite(total) || total < 0) return fail("invalid_invoice_total", { status: 400, functionName: FN });
      clean.invoice_total = Math.round(total * 100) / 100;
    }
    if ("invoice_previous_balance" in clean) {
      const previous = Number(clean.invoice_previous_balance);
      if (!Number.isFinite(previous)) return fail("invalid_invoice_previous_balance", { status: 400, functionName: FN });
      clean.invoice_previous_balance = Math.round(previous * 100) / 100;
    }
    if (Object.keys(clean).length === 0) return fail("empty_patch", { status: 400, functionName: FN });
    const { data, error } = await sb.from("document_imports").update(clean)
      .eq("id", document_id).eq("user_id", user.id).select().maybeSingle();
    if (error) return fail("update_failed", { status: 400, functionName: FN, details: { details: error.message} });
    if (!data) return fail("not_found", { status: 404, functionName: FN });
    return json({ ok: true, document: data });
  }

  if (action === "cancel") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    const { data, error } = await userClient.rpc("cancel_document_import", { p_document_id: document_id });
    if (error) return fail("rpc_failed", { status: 400, functionName: FN, details: { details: error.message} });
    if (!(data as { ok?: boolean } | null)?.ok) {
      return fail("cancel_rejected", { status: 409, functionName: FN, details: { result: data} });
    }
    return json({ ok: true, result: data });
  }

  if (action === "reconcile") {
    const document_id = String(body.document_id ?? "");
    const account_id = String(body.account_id ?? "");
    if (!document_id || !account_id) return fail("missing_fields", { status: 400, functionName: FN });
    const { data, error } = await userClient.rpc("reconcile_document_balance", {
      p_document_id: document_id, p_account_id: account_id,
    });
    if (error) return fail("rpc_failed", { status: 400, functionName: FN, details: { details: error.message} });
    return json({ ok: true, result: data });
  }

  if (action === "rollback") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    const { data, error } = await userClient.rpc("rollback_document_import", { p_document_id: document_id });
    if (error) return fail("rpc_failed", { status: 400, functionName: FN, details: { details: error.message} });
    return json({ ok: true, result: data });
  }

  if (action === "reprocess-rejected") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    const reason_codes = Array.isArray(body.reason_codes) && body.reason_codes.length > 0
      ? (body.reason_codes as string[])
      : ["invalid_movement_kind", "invalid_payment_method", "empty_description", "invalid_date"];
    const { data, error } = await userClient.rpc("reprocess_rejected_items", {
      p_document_id: document_id, p_reason_codes: reason_codes,
    });
    if (error) return fail("rpc_failed", { status: 400, functionName: FN, details: { details: error.message} });
    return json({ ok: true, result: data });
  }

  if (action === "set-source-context") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    const account_id = body.account_id ? String(body.account_id) : null;
    const credit_card_id = body.credit_card_id ? String(body.credit_card_id) : null;
    if (account_id && credit_card_id) return fail("conflicting_source", { status: 400, functionName: FN });
    const propagate = body.propagate !== false;
    const patch = {
      source_account_id: account_id,
      source_credit_card_id: credit_card_id,
      source_context_method: "user_selected",
      source_context_confidence: 1,
      source_context_reason: "user_selected",
    };
    const { error: docErr } = await sb.from("document_imports").update(patch).eq("id", document_id).eq("user_id", user.id);
    if (docErr) return fail("update_failed", { status: 400, functionName: FN, details: { details: docErr.message} });
    let propagated = 0;
    if (propagate) {
      const itemPatch: Record<string, unknown> = account_id
        ? { account_id, credit_card_id: null, payment_method: "account" }
        : credit_card_id
        ? { credit_card_id, account_id: null, payment_method: "credit_card" }
        : { account_id: null, credit_card_id: null };
      const { data: updated, error: upErr } = await sb.from("extracted_items").update(itemPatch)
        .eq("document_id", document_id).eq("user_id", user.id)
        .in("status", ["needs_review", "duplicate_suspect"])
        // Guarda anti-destrutiva: nunca sobrescrever itens já editados
        // manualmente. Se o usuário fixou conta/cartão em uma linha,
        // essa escolha vence a propagação em lote.
        .is("user_edited_at", null)
        .select("id");
      if (upErr) return fail("propagate_failed", { status: 400, functionName: FN, details: { details: upErr.message} });
      propagated = (updated ?? []).length;
    }
    return json({ ok: true, propagated });
  }

  if (action === "learn-alias") {
    const raw = String(body.alias_key ?? "").trim();
    const friendly_name = String(body.friendly_name ?? "").trim();
    if (!raw || !friendly_name) return fail("missing_fields", { status: 400, functionName: FN });
    const key = aliasKey(raw);
    if (!key) return fail("empty_key", { status: 400, functionName: FN });
    const category_id = body.category_id ? String(body.category_id) : null;
    const { data: existing } = await sb.from("merchant_aliases")
      .select("id,hits").eq("user_id", user.id).eq("alias_key", key).maybeSingle();
    if (existing) {
      const { data, error } = await sb.from("merchant_aliases").update({
        friendly_name, category_id, hits: ((existing as { hits?: number }).hits ?? 1) + 1,
        last_used_at: new Date().toISOString(), learned_from: "confirmation",
      }).eq("id", existing.id).select().maybeSingle();
      if (error) return fail("update_failed", { status: 400, functionName: FN, details: { details: error.message} });
      return json({ ok: true, alias: data });
    }
    const { data, error } = await sb.from("merchant_aliases").insert({
      user_id: user.id, alias_key: key, friendly_name, category_id, learned_from: "confirmation",
    }).select().maybeSingle();
    if (error) return fail("insert_failed", { status: 400, functionName: FN, details: { details: error.message} });
    return json({ ok: true, alias: data });
  }

  return fail("unknown_action", { status: 400, functionName: FN });
});
