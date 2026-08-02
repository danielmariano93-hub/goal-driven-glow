// Estágio de importação: grava o lote na trilha canônica
// (`document_imports` + `extracted_items`) para revisão antes da confirmação.
//
// Todos os canais (JSON no chat, PDF, imagem, CSV, OFX, WhatsApp, MCP) passam
// por aqui, então a prévia, a revisão no app e o registro idempotente são
// exatamente os mesmos. Itens inválidos ficam em quarentena (contados, nunca
// gravados como lançamento).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeDescription, merchantCanonical } from "../categorization/normalize.ts";
import { classifyBatch, fetchExistingCandidates, linkRefunds, type DupeVerdict } from "./dedupe.ts";
import type { ImportItem } from "./schema.ts";

export type BatchTarget = {
  kind: "account" | "credit_card";
  id: string;
  name: string;
};

export type StageCounters = {
  total: number;
  new: number;
  repeated_legitimate: number;
  exact_duplicate: number;
  probable_duplicate: number;
  needs_review: number;
  invalid: number;
};

export type StagedBatch = {
  document_id: string;
  counters: StageCounters;
  /** ids de extracted_items prontos para importar (status `new`) */
  ready_item_ids: string[];
  total_expense: number;
  total_income: number;
  total_transfer: number;
  total_refund: number;
};

function fold(value: string): string {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function today(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

async function fingerprint(user_id: string, item: ImportItem, date: string): Promise<string> {
  const base = [
    user_id,
    date,
    item.amount.toFixed(2),
    item.type,
    item.movement_kind,
    merchantCanonical(item.raw_description ?? item.description),
  ].join("|");
  const bytes = new TextEncoder().encode(base);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Lookups = {
  accounts: Array<{ id: string; name: string }>;
  cards: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
};

async function loadLookups(sb: SupabaseClient, user_id: string): Promise<Lookups> {
  const [accounts, cards, categories] = await Promise.all([
    sb.from("accounts").select("id,name").eq("user_id", user_id).eq("active", true),
    sb.from("credit_cards").select("id,name").eq("user_id", user_id),
    sb.from("categories").select("id,name").is("archived_at", null).or(`user_id.eq.${user_id},user_id.is.null`),
  ]);
  return {
    accounts: (accounts.data ?? []) as any[],
    cards: (cards.data ?? []) as any[],
    categories: (categories.data ?? []) as any[],
  };
}

function matchByName(list: Array<{ id: string; name: string }>, hint?: string | null): string | null {
  const needle = fold(hint ?? "");
  if (!needle) return null;
  const exact = list.find((row) => fold(row.name) === needle);
  if (exact) return exact.id;
  const partial = list.find((row) => fold(row.name).includes(needle) || needle.includes(fold(row.name)));
  return partial?.id ?? null;
}

/**
 * Grava o lote como um `document_imports` em `needs_review`, classificando cada
 * item contra o histórico já registrado. Não cria nenhum lançamento.
 */
export async function stageBatch(sb: SupabaseClient, args: {
  user_id: string;
  conversation_id?: string | null;
  source: "app" | "whatsapp";
  items: ImportItem[];
  target: BatchTarget;
  raw_text?: string | null;
  document_kind?: string;
}): Promise<StagedBatch> {
  const { user_id, items, target } = args;
  const lookups = await loadLookups(sb, user_id);

  // Datas resolvidas por item (nunca uma data única para o lote).
  const dated = items.map((item) => ({
    item,
    date: item.occurred_at ?? item.purchase_date ?? item.posted_at ?? today(),
    dateMissing: !item.occurred_at && !item.purchase_date && !item.posted_at,
  }));

  const fingerprints = await Promise.all(dated.map((row) => fingerprint(user_id, row.item, row.date)));
  const existing = await fetchExistingCandidates(sb as any, user_id, dated.map((row, i) => ({
    ordinal: row.item.ordinal,
    type: row.item.type,
    amount: row.item.amount,
    occurred_at: row.date,
    posted_at: row.item.posted_at,
    purchase_date: row.item.purchase_date,
    description: row.item.description,
    raw_description: row.item.raw_description,
    merchant: row.item.merchant,
    bank_reference: row.item.bank_reference,
    external_id: row.item.external_id,
    source_document_id: row.item.source_document_id,
    source_line_index: row.item.source_line_index ?? row.item.ordinal,
    fingerprint: fingerprints[i],
  })));

  const verdicts: DupeVerdict[] = classifyBatch(
    dated.map((row, i) => ({
      type: row.item.type,
      amount: row.item.amount,
      occurred_at: row.date,
      posted_at: row.item.posted_at,
      purchase_date: row.item.purchase_date,
      description: row.item.description,
      raw_description: row.item.raw_description,
      merchant: row.item.merchant,
      bank_reference: row.item.bank_reference,
      external_id: row.item.external_id,
      source_document_id: row.item.source_document_id,
      source_line_index: row.item.source_line_index ?? row.item.ordinal,
      fingerprint: fingerprints[i],
    })),
    existing,
  );
  const refundLinks = linkRefunds(items, existing);

  const counters: StageCounters = {
    total: items.length,
    new: 0,
    repeated_legitimate: 0,
    exact_duplicate: 0,
    probable_duplicate: 0,
    needs_review: 0,
    invalid: 0,
  };
  let total_expense = 0;
  let total_income = 0;
  let total_transfer = 0;
  let total_refund = 0;

  const { data: doc, error: docError } = await sb.from("document_imports").insert({
    user_id,
    source: args.source,
    storage_path: "inline:batch",
    mime_type: "application/json",
    size_bytes: (args.raw_text ?? "").length,
    sha256: `pending:batch:${crypto.randomUUID()}`,
    document_kind: args.document_kind ?? "list",
    status: "needs_review",
    conversation_id: args.conversation_id ?? null,
    raw_text: (args.raw_text ?? "").slice(0, 20_000) || null,
    source_account_id: target.kind === "account" ? target.id : null,
    source_credit_card_id: target.kind === "credit_card" ? target.id : null,
    source_context_method: "guidance",
  }).select("id").single();
  if (docError || !doc) throw new Error(`stage_document_failed:${docError?.message ?? "unknown"}`);
  const document_id = String((doc as any).id);

  const rows: any[] = [];
  dated.forEach((row, index) => {
    const item = row.item;
    const verdict = verdicts[index];
    const invalid = !(item.amount > 0) || !item.description;
    if (invalid) {
      counters.invalid++;
      return;
    }

    const itemTarget = {
      account_id: matchByName(lookups.accounts, item.account_hint) ?? (target.kind === "account" && !item.card_hint ? target.id : null),
      credit_card_id: matchByName(lookups.cards, item.card_hint) ?? (target.kind === "credit_card" && !item.account_hint ? target.id : null),
    };
    if (itemTarget.account_id && itemTarget.credit_card_id) itemTarget.account_id = null;

    const issues = [...item.issues];
    if (row.dateMissing) issues.push("data_inferida_hoje");

    let status: string;
    let duplicate_reason: string | null = null;
    if (verdict.status === "exact_duplicate") {
      status = "duplicate_suspect";
      duplicate_reason = `exato:${verdict.reason_code}`;
      counters.exact_duplicate++;
    } else if (verdict.status === "probable_duplicate") {
      status = "duplicate_suspect";
      duplicate_reason = `possivel:${verdict.reason_code}`;
      counters.probable_duplicate++;
    } else if (verdict.status === "repeated_legitimate") {
      // Linha idêntica repetida na origem: é um lançamento real distinto.
      status = "needs_review";
      issues.push("linha_repetida_na_origem");
      counters.repeated_legitimate++;
    } else if (issues.length > 0 || item.confidence < 0.7) {
      status = "needs_review";
      counters.needs_review++;
    } else {
      status = "needs_review";
      counters.new++;
    }

    if (verdict.status === "new" || verdict.status === "repeated_legitimate") {
      if (item.movement_kind === "internal_transfer") total_transfer += item.amount;
      else if (item.movement_kind === "refund") total_refund += item.amount;
      else if (item.type === "income") total_income += item.amount;
      else total_expense += item.amount;
    }

    rows.push({
      document_id,
      user_id,
      idx: item.ordinal,
      status,
      type: item.type,
      amount: item.amount,
      occurred_at: row.date,
      purchase_date: item.purchase_date,
      description: item.description,
      raw_description: item.raw_description,
      normalized_description: normalizeDescription(item.raw_description ?? item.description) || null,
      friendly_description: item.description,
      bank_description: item.raw_description,
      payment_method: item.payment_method ?? (itemTarget.credit_card_id ? "credit_card" : "account"),
      account_hint: item.account_hint,
      card_hint: item.card_hint,
      account_id: itemTarget.account_id,
      credit_card_id: itemTarget.credit_card_id,
      category_id: matchByName(lookups.categories, item.category_hint),
      category_hint: item.category_hint,
      category_source: item.category_hint ? "document_hint" : null,
      installments_total: item.installments_total,
      installment_number: item.installment_number,
      movement_kind: item.movement_kind,
      bank_reference: item.bank_reference ?? item.external_id,
      dedupe_fingerprint: fingerprints[index],
      duplicate_of: verdict.duplicate_of,
      duplicate_reason,
      confidence: { value: item.confidence, issues },
      raw: {
        external_id: item.external_id,
        reverses_external_id: item.reverses_external_id ?? refundLinks.get(item.ordinal) ?? null,
        posted_at: item.posted_at,
        posted_at_source: item.posted_at_source,
        source_document_id: item.source_document_id,
        source_line_index: item.source_line_index ?? item.ordinal,
        merchant: item.merchant,
        issues,
      },
    });
  });

  if (rows.length > 0) {
    const { error: itemsError } = await sb.from("extracted_items").insert(rows);
    if (itemsError) throw new Error(`stage_items_failed:${itemsError.message}`);
  }

  await sb.from("document_imports").update({
    counters: { ...counters, total_expense, total_income, total_transfer, total_refund },
  }).eq("id", document_id);

  const { data: readyRows } = await sb.from("extracted_items")
    .select("id, duplicate_reason, confidence")
    .eq("document_id", document_id)
    .eq("status", "needs_review");

  const ready_item_ids = ((readyRows ?? []) as any[])
    .filter((row) => !row.duplicate_reason && ((row.confidence?.issues ?? []).length === 0))
    .map((row) => String(row.id));

  return { document_id, counters, ready_item_ids, total_expense, total_income, total_transfer, total_refund };
}
