// Parser único de lotes de lançamentos (`import_item.v1`).
//
// Aceita, na mesma função:
//   1. JSON estruturado: { "lancamentos": [ { data, descricao, valor, tipo,
//      categoria, movement_kind, conta, cartao, parcela, external_id, ... } ] }
//   2. JSON compacto em arrays (formato do extrator de documentos);
//   3. linhas soltas "Descrição R$ 12,34" (último recurso).
//
// Regra dura: a data informada por item NUNCA é sobrescrita. Item sem data
// recebe `occurred_at = null` e sai marcado com o issue `data_ausente`, para
// que a camada de classificação o mande para revisão em vez de inventar uma.

import {
  type ImportItem,
  type MovementKind,
  isMovementKind,
  parseItemDate,
  resolveNature,
} from "./schema.ts";
import { isCreditDescription } from "../ledger/creditSemantics.ts";
import { merchantCanonical } from "../categorization/normalize.ts";

const MONEY_RX = /(?:r\$\s*)?(-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|-?\d+,\d{1,2}|-?\d+\.\d{1,2}|-?\d+)\s*$/i;

export type BatchParseResult = {
  items: ImportItem[];
  skipped: number;
  source: "json" | "lines" | "none";
};

export function parseAmountLoose(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? "").trim().replace(/^r\$\s*/i, "").replace(/\s/g, "");
  if (!s) return null;
  const negative = /^-/.test(s) || /\)$/.test(s);
  s = s.replace(/^-/, "").replace(/[()]/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  return negative ? -n : n;
}

function cleanDesc(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[•\-–—*·]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 160);
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return null;
}

function intOrNull(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function baseItem(ordinal: number): ImportItem {
  return {
    ordinal,
    occurred_at: null,
    posted_at: null,
    posted_at_source: null,
    purchase_date: null,
    amount: 0,
    type: "expense",
    movement_kind: "transaction",
    description: "",
    raw_description: null,
    merchant: null,
    category_hint: null,
    account_hint: null,
    card_hint: null,
    payment_method: null,
    installments_total: null,
    installment_number: null,
    external_id: null,
    source_document_id: null,
    source_line_index: ordinal,
    bank_reference: null,
    reverses_external_id: null,
    confidence: 0.9,
    issues: [],
  };
}

/** Aplica sinal, natureza e coerções finais a um item já preenchido. */
function finalize(item: ImportItem): ImportItem {
  const issues = [...item.issues];
  if (item.amount < 0) {
    // Valor negativo em despesa é crédito; em receita é despesa.
    item.type = item.type === "expense" ? "income" : "expense";
    if (item.movement_kind === "transaction") item.movement_kind = "refund";
    issues.push("valor_negativo_tratado_como_credito");
  }
  item.amount = Math.abs(Number(item.amount.toFixed(2)));

  if (item.type === "expense" && item.movement_kind === "transaction" && isCreditDescription(item.description)) {
    item.type = "income";
    item.movement_kind = "refund";
    issues.push("descricao_de_credito");
  }
  if (item.movement_kind === "refund" && item.type === "expense") item.type = "income";
  if (item.movement_kind === "card_payment") item.payment_method = "account";
  if (item.card_hint && !item.payment_method) item.payment_method = "credit_card";
  if (!item.occurred_at) issues.push("data_ausente");
  if (!item.description) issues.push("descricao_ausente");
  if (!(item.amount > 0)) issues.push("valor_invalido");
  item.merchant = item.merchant ?? (merchantCanonical(item.raw_description ?? item.description) || null);
  item.issues = [...new Set(issues)];
  return item;
}

function fromObjectRow(row: Record<string, unknown>, ordinal: number): ImportItem | null {
  const description = cleanDesc(pick(row, [
    "descricao", "descrição", "description", "estabelecimento", "titulo", "title", "merchant", "historico", "histórico",
  ]));
  const amount = parseAmountLoose(pick(row, ["valor", "amount", "value", "total"]));
  if (!description && amount === null) return null;

  const item = baseItem(ordinal);
  const nature = resolveNature(pick(row, ["tipo", "type"]), pick(row, ["movement_kind", "movimento", "natureza"]));
  const explicitKind = pick(row, ["movement_kind"]);

  item.description = description;
  item.raw_description = String(pick(row, ["raw_description", "descricao_original", "descricao_banco"]) ?? description) || null;
  item.amount = amount ?? 0;
  item.type = nature.type ?? (amount !== null && amount < 0 ? "income" : "expense");
  item.movement_kind = isMovementKind(explicitKind) ? explicitKind as MovementKind : nature.kind;
  item.payment_method = nature.method
    ?? (String(pick(row, ["forma_pagamento", "payment_method", "meio"]) ?? "").match(/cart|credit/i)
      ? "credit_card"
      : String(pick(row, ["forma_pagamento", "payment_method", "meio"]) ?? "").match(/conta|account|debito|débito|pix/i)
        ? "account"
        : null);
  item.occurred_at = parseItemDate(pick(row, ["data", "date", "occurred_at", "data_lancamento", "data_movimento"]));
  item.posted_at = parseItemDate(pick(row, ["data_processamento", "posted_at", "data_credito", "data_lancamento", "data_liquidacao"]));
  if (item.posted_at) item.posted_at_source = "statement";
  item.purchase_date = parseItemDate(pick(row, ["data_compra", "purchase_date"]));
  item.category_hint = (pick(row, ["categoria", "category", "category_hint"]) as string | null) ?? null;
  item.account_hint = (pick(row, ["conta", "account", "account_hint", "banco"]) as string | null) ?? null;
  item.card_hint = (pick(row, ["cartao", "cartão", "card", "card_hint"]) as string | null) ?? null;
  item.merchant = (pick(row, ["comerciante", "merchant_canonical"]) as string | null) ?? null;
  item.installments_total = intOrNull(pick(row, ["parcelas_total", "installments_total", "parcelas"]));
  item.installment_number = intOrNull(pick(row, ["parcela_numero", "installment_number", "parcela"]));
  item.external_id = (pick(row, ["external_id", "referencia_externa", "id_externo"]) as string | null) ?? null;
  item.bank_reference = (pick(row, ["bank_reference", "referencia_bancaria", "autorizacao"]) as string | null) ?? null;
  item.reverses_external_id = (pick(row, [
    "reverses_external_id", "estorno_de", "transacao_original", "original_external_id",
  ]) as string | null) ?? null;
  const conf = Number(pick(row, ["confidence", "confianca", "confiança"]));
  item.confidence = Number.isFinite(conf) && conf > 0 && conf <= 1 ? conf : 0.9;
  return finalize(item);
}

/** Linhas compactas [tipo,data,valor,descrição,...] do extrator de documentos. */
function fromCompactRow(row: unknown[], ordinal: number): ImportItem | null {
  const description = cleanDesc(row[3]);
  const amount = parseAmountLoose(row[2]);
  if (!description || amount === null) return null;
  const item = baseItem(ordinal);
  item.description = description;
  item.raw_description = description;
  item.amount = amount;
  item.type = row[0] === "income" ? "income" : "expense";
  item.movement_kind = isMovementKind(row[7]) ? row[7] as MovementKind : "transaction";
  item.occurred_at = parseItemDate(row[1]);
  item.installments_total = intOrNull(row[8]);
  item.installment_number = intOrNull(row[9]);
  item.category_hint = typeof row[12] === "string" ? row[12] : null;
  return finalize(item);
}

function fromJson(text: string): ImportItem[] | null {
  const start = text.indexOf("{");
  const startArr = text.indexOf("[");
  const first = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (first === -1) return null;
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (last <= first) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
  const container = parsed as Record<string, unknown> | unknown[];
  const arr = Array.isArray(container)
    ? container
    : (container?.["lancamentos"] ?? container?.["lançamentos"] ?? container?.["itens"] ?? container?.["items"]
      ?? container?.["transacoes"] ?? container?.["transactions"] ?? container?.["i"] ?? container?.["gastos"]
      ?? container?.["despesas"]);
  if (!Array.isArray(arr)) return null;

  const items: ImportItem[] = [];
  for (const row of arr) {
    const ordinal = items.length;
    const item = Array.isArray(row)
      ? fromCompactRow(row, ordinal)
      : row && typeof row === "object"
        ? fromObjectRow(row as Record<string, unknown>, ordinal)
        : null;
    if (item) items.push(item);
  }
  return items.length ? items : null;
}

function fromLines(text: string): ImportItem[] {
  const items: ImportItem[] = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length < 4) continue;
    const m = line.match(MONEY_RX);
    if (!m) continue;
    const amount = parseAmountLoose(m[1]);
    if (amount === null) continue;
    const head = line.slice(0, line.length - m[0].length).replace(/[:;,|]+$/, "");
    const dateMatch = head.match(/(\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?|\d{4}-\d{2}-\d{2})/);
    const description = cleanDesc(dateMatch ? head.replace(dateMatch[0], " ") : head);
    if (!description || /^total/i.test(description)) continue;
    const item = baseItem(items.length);
    item.description = description;
    item.raw_description = line.slice(0, 200);
    item.amount = amount;
    item.occurred_at = dateMatch ? parseItemDate(dateMatch[0]) : null;
    item.confidence = 0.6;
    items.push(finalize(item));
  }
  return items;
}

/** Detecta e normaliza um lote de lançamentos em qualquer um dos formatos aceitos. */
export function parseBatch(text: string, minItems = 3): BatchParseResult {
  const raw = String(text ?? "");
  const json = fromJson(raw);
  if (json && json.length >= minItems) {
    return { items: json.map((it, i) => ({ ...it, ordinal: i })), skipped: 0, source: "json" };
  }
  const lines = fromLines(raw);
  if (lines.length >= minItems) {
    const totalLines = raw.split(/\r?\n/).filter((l) => l.trim().length > 3).length;
    return { items: lines, skipped: Math.max(0, totalLines - lines.length), source: "lines" };
  }
  return { items: [], skipped: 0, source: "none" };
}

/** Soma líquida do lote: créditos (receita/estorno/pagamento de fatura) reduzem. */
export function sumBatch(items: ImportItem[]): number {
  return items.reduce((acc, item) => {
    const reduces = item.type === "income" || item.movement_kind === "card_payment";
    return acc + (reduces ? -item.amount : item.amount);
  }, 0);
}
