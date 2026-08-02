// Motor único de deduplicação de lançamentos importados.
//
// Antes vivia embutido em `assistant-ingest-document`. Agora é compartilhado
// por documento (PDF/imagem), JSON no chat, CSV/OFX e WhatsApp — nenhum canal
// pode ter uma regra de duplicidade diferente.
//
// Chaves fortes (duplicidade exata):
//   • mesmo `dedupe_fingerprint`;
//   • mesma referência bancária / id externo;
//   • mesmo tipo + valor + comerciante canônico na MESMA data.
// Sinais fracos (possível duplicidade — vão para revisão):
//   • mesmo tipo + valor + comerciante dentro de uma janela de ±N dias
//     (compra x processamento);
//   • mesmo tipo + valor + data, comerciante diferente.
// Cada transação existente só absorve UM item: duas compras reais de mesmo
// valor no mesmo dia continuam sendo duas.

import { merchantCanonical } from "../categorization/normalize.ts";
import type { ImportItem } from "./schema.ts";

export type ExistingTx = {
  id: string;
  type: string;
  amount: number;
  occurred_at: string;
  description?: string | null;
  raw_description?: string | null;
  bank_reference?: string | null;
  dedupe_fingerprint?: string | null;
  movement_kind?: string | null;
  import_source_id?: string | null;
};

export type DupeVerdict = {
  status: "new" | "exact_duplicate" | "probable_duplicate";
  reason_code: string | null;
  duplicate_of: string | null;
};

export const DEFAULT_WINDOW_DAYS = 3;

function daysApart(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((da - db) / 86_400_000));
}

function merchantOf(value?: string | null): string {
  return merchantCanonical(value ?? "");
}

function sameCents(a: number, b: number): boolean {
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

export type DedupeInputItem = {
  ordinal?: number;
  type: string;
  amount: number;
  occurred_at: string | null;
  posted_at?: string | null;
  purchase_date?: string | null;
  description?: string | null;
  raw_description?: string | null;
  merchant?: string | null;
  bank_reference?: string | null;
  external_id?: string | null;
  fingerprint?: string | null;
};

/**
 * Classifica um lote inteiro contra as transações já existentes do usuário.
 * Retorna um veredito por índice, na mesma ordem do lote.
 */
export function classifyBatch(
  items: DedupeInputItem[],
  existing: ExistingTx[],
  opts: { windowDays?: number } = {},
): DupeVerdict[] {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const consumed = new Set<string>();

  const fpIndex = new Map<string, ExistingTx>();
  const refIndex = new Map<string, ExistingTx>();
  for (const tx of existing) {
    if (tx.dedupe_fingerprint) fpIndex.set(tx.dedupe_fingerprint, tx);
    if (tx.bank_reference) refIndex.set(String(tx.bank_reference).toUpperCase(), tx);
    if (tx.import_source_id) refIndex.set(String(tx.import_source_id).toUpperCase(), tx);
  }

  const verdicts: DupeVerdict[] = [];
  for (const item of items) {
    const dates = [item.occurred_at, item.posted_at, item.purchase_date].filter((d): d is string => !!d);
    const itemMerchant = item.merchant ? merchantOf(item.merchant) : merchantOf(item.raw_description ?? item.description);

    // 1. fingerprint
    const fpHit = item.fingerprint ? fpIndex.get(item.fingerprint) : undefined;
    if (fpHit && !consumed.has(fpHit.id)) {
      consumed.add(fpHit.id);
      verdicts.push({ status: "exact_duplicate", reason_code: "fingerprint", duplicate_of: fpHit.id });
      continue;
    }

    // 2. referência bancária / id externo
    const refKey = (item.bank_reference ?? item.external_id ?? "").toUpperCase();
    const refHit = refKey ? refIndex.get(refKey) : undefined;
    if (refHit && !consumed.has(refHit.id)) {
      consumed.add(refHit.id);
      verdicts.push({ status: "exact_duplicate", reason_code: "referencia_bancaria", duplicate_of: refHit.id });
      continue;
    }

    // 3/4. tipo + valor + (data|janela) + comerciante
    const candidates = existing.filter((tx) =>
      !consumed.has(tx.id)
      && tx.type === item.type
      && sameCents(tx.amount, item.amount)
      && dates.some((d) => daysApart(tx.occurred_at, d) <= windowDays)
    );
    if (candidates.length === 0) {
      verdicts.push({ status: "new", reason_code: null, duplicate_of: null });
      continue;
    }

    const withMerchant = candidates.map((tx) => ({
      tx,
      merchant: merchantOf(tx.raw_description ?? tx.description),
      gap: Math.min(...dates.map((d) => daysApart(tx.occurred_at, d))),
    }));

    const exact = withMerchant.find((c) => c.gap === 0 && c.merchant && itemMerchant && c.merchant === itemMerchant);
    if (exact) {
      consumed.add(exact.tx.id);
      verdicts.push({ status: "exact_duplicate", reason_code: "data+valor+comerciante", duplicate_of: exact.tx.id });
      continue;
    }

    const nearMerchant = withMerchant.find((c) => c.merchant && itemMerchant && c.merchant === itemMerchant);
    if (nearMerchant) {
      consumed.add(nearMerchant.tx.id);
      verdicts.push({
        status: "probable_duplicate",
        reason_code: `janela_${nearMerchant.gap}d+comerciante`,
        duplicate_of: nearMerchant.tx.id,
      });
      continue;
    }

    const sameDay = withMerchant.find((c) => c.gap === 0);
    if (sameDay) {
      consumed.add(sameDay.tx.id);
      verdicts.push({
        status: "probable_duplicate",
        reason_code: "data+valor_descricao_diferente",
        duplicate_of: sameDay.tx.id,
      });
      continue;
    }

    verdicts.push({ status: "new", reason_code: null, duplicate_of: null });
  }
  return verdicts;
}

/** Casa estornos do lote com o lançamento original já registrado. */
export function linkRefunds(items: ImportItem[], existing: ExistingTx[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const item of items) {
    if (item.movement_kind !== "refund") continue;
    const merchant = merchantOf(item.merchant ?? item.raw_description ?? item.description);
    const original = existing.find((tx) =>
      tx.type === "expense"
      && sameCents(tx.amount, item.amount)
      && merchant
      && merchantOf(tx.raw_description ?? tx.description) === merchant
    );
    if (original) map.set(item.ordinal, original.id);
  }
  return map;
}

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        gte: (col: string, val: unknown) => {
          lte: (col: string, val: unknown) => { limit: (n: number) => Promise<{ data: unknown }> };
        };
      };
    };
  };
};

/**
 * Busca as transações candidatas do usuário: mesma faixa de datas do lote,
 * ampliada pela janela de tolerância. Deixa o filtro fino para `classifyBatch`.
 */
export async function fetchExistingCandidates(
  sb: SupabaseLike,
  user_id: string,
  items: DedupeInputItem[],
  opts: { windowDays?: number; limit?: number } = {},
): Promise<ExistingTx[]> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const dates = items
    .flatMap((it) => [it.occurred_at, it.posted_at, it.purchase_date])
    .filter((d): d is string => !!d)
    .sort();
  if (dates.length === 0) return [];
  const shift = (iso: string, days: number) =>
    new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const from = shift(dates[0], -windowDays);
  const to = shift(dates[dates.length - 1], windowDays);

  const { data } = await sb
    .from("transactions")
    .select("id, type, amount, occurred_at, description, raw_description, bank_reference, dedupe_fingerprint, movement_kind, import_source_id")
    .eq("user_id", user_id)
    .gte("occurred_at", from)
    .lte("occurred_at", to)
    .limit(opts.limit ?? 4000);
  return ((data ?? []) as ExistingTx[]);
}
