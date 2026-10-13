// Janela incremental do Open Finance: cada conta vinculada lembra até onde já foi extraída.
// Funções puras (sem I/O) — o carregamento dos ids já vistos fica na função de borda.
//
// Regras:
//  • sem cursor (primeira extração) → começa no dia 1 do mês atual (corte já existente);
//  • com cursor → começa alguns dias ANTES dele (lançamentos que o banco postou com atraso);
//    a sobreposição é inofensiva porque o que já foi visto é filtrado por id;
//  • `days` explícito vence tudo (busca manual de um período maior);
//  • item já visto em extração anterior (ignorado, aguardando revisão ou confirmado) não volta.
import type { ImportItem } from "../import/schema.ts";

export const OVERLAP_DAYS = 5;
export const MAX_DAYS = 365;

/** Estados de um item extraído que significam "a pessoa já tem isso em mãos". */
export const SEEN_ITEM_STATUSES = ["ignored", "needs_review", "duplicate_suspect", "confirmed", "ready", "imported"] as const;

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export type ExtractionWindow = { from: string; reason: "explicit_days" | "cursor" | "month_start" };

export function resolveExtractionWindow(args: {
  to: string;
  cursor: string | null | undefined;
  explicitDays?: number | null;
}): ExtractionWindow {
  const { to, cursor } = args;
  const explicit = Number(args.explicitDays);
  if (Number.isFinite(explicit) && explicit > 0) {
    return { from: addDays(to, -Math.min(MAX_DAYS, Math.floor(explicit))), reason: "explicit_days" };
  }
  const monthStart = `${to.slice(0, 8)}01`;
  if (cursor && /^\d{4}-\d{2}-\d{2}$/.test(cursor) && cursor <= to) {
    return { from: addDays(cursor, -OVERLAP_DAYS), reason: "cursor" };
  }
  return { from: monthStart, reason: "month_start" };
}

/** Tira os itens cujo id do banco já passou por uma extração anterior. */
export function dropAlreadySeen(items: ImportItem[], seen: ReadonlySet<string>): { kept: ImportItem[]; dropped: number } {
  if (seen.size === 0) return { kept: items, dropped: 0 };
  const kept = items.filter((i) => !seen.has(String(i.external_id ?? i.bank_reference ?? "")));
  return { kept, dropped: items.length - kept.length };
}

type Row = { bank_reference: string | null; status: string; document_id: string };

/**
 * Ids (`pluggy:<id>`) que já passaram por extração. Itens de lote DESCARTADO (documento cancelado)
 * não contam: descartar o lote significa "quero buscar de novo".
 */
export async function loadSeenExternalIds(
  sb: { from: (t: string) => any },
  userId: string,
  externalIds: string[],
  statuses: readonly string[] = SEEN_ITEM_STATUSES,
): Promise<Set<string>> {
  const seen = new Set<string>();
  const unique = [...new Set(externalIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 150) {
    const chunk = unique.slice(i, i + 150);
    const { data, error } = await sb.from("extracted_items")
      .select("bank_reference,status,document_id")
      .eq("user_id", userId).in("bank_reference", chunk).in("status", [...statuses]);
    if (error) throw new Error(`seen_lookup_failed:${error.message}`);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) continue;
    const docIds = [...new Set(rows.map((r) => r.document_id))];
    const { data: docs, error: docError } = await sb.from("document_imports")
      .select("id,status").eq("user_id", userId).in("id", docIds);
    if (docError) throw new Error(`seen_lookup_failed:${docError.message}`);
    const canceled = new Set(((docs ?? []) as Array<{ id: string; status: string }>).filter((d) => d.status === "canceled").map((d) => d.id));
    for (const r of rows) if (r.bank_reference && !canceled.has(r.document_id)) seen.add(r.bank_reference);
  }
  return seen;
}
