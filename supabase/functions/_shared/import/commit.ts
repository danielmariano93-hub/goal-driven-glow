// Confirmação idempotente de um lote estagiado + relatório final da importação.
//
// A gravação é sempre via `confirm_document_import`, que insere com origem
// `import`, guarda `dedupe_fingerprint`/`bank_reference` e marca o item como
// confirmado. Reenviar a mesma confirmação não duplica nada: itens já com
// `transaction_id` voltam como `skipped`.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export type ImportReport = {
  ok: boolean;
  imported: number;
  skipped: number;
  failed: number;
  exact_duplicates: number;
  probable_duplicates: number;
  pending_review: number;
  invalid: number;
  total_expense: number;
  total_income: number;
  total_transfer: number;
  total_refund: number;
  transaction_ids: string[];
  ignored_item_ids: string[];
  error?: string | null;
  details?: Record<string, unknown> | null;
};

export type BatchPreview = {
  total: number;
  new: number;
  exact_duplicate: number;
  probable_duplicate: number;
  needs_review: number;
  invalid: number;
};

/** Prévia enviada ANTES de qualquer gravação. */
export function formatPreview(counts: BatchPreview, args: {
  targetName: string;
  netTotal: number;
  periodLabel?: string | null;
  reviewLink?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`Encontrei ${counts.total} lançamentos${args.periodLabel ? ` (${args.periodLabel})` : ""}:`);
  lines.push(`• ${counts.new} novos`);
  if (counts.exact_duplicate > 0) lines.push(`• ${counts.exact_duplicate} já registrados`);
  if (counts.probable_duplicate > 0) lines.push(`• ${counts.probable_duplicate} possíveis duplicidades`);
  if (counts.needs_review > 0) lines.push(`• ${counts.needs_review} precisam de revisão`);
  if (counts.invalid > 0) lines.push(`• ${counts.invalid} ilegíveis (deixei de fora)`);
  lines.push("");
  lines.push(`Destino: ${args.targetName} · Total líquido dos novos: ${BRL.format(args.netTotal)}`);
  if (args.reviewLink) lines.push(`Revisar item a item: ${args.reviewLink}`);
  lines.push("");
  lines.push("Responda *CONFIRMAR* para registrar só os novos ou *CANCELAR* para descartar.");
  return lines.join("\n");
}

/** Relatório final, depois da gravação. */
export function formatReport(report: ImportReport, targetName: string): string {
  if (!report.ok && report.imported === 0) {
    return `Não consegui registrar o lote${report.error ? ` (${report.error})` : ""}. Nada foi gravado — pode reenviar?`;
  }
  const lines: string[] = [];
  lines.push(`Importação concluída em ${targetName}. ✅`);
  lines.push(`• Registrados: ${report.imported}`);
  if (report.skipped > 0) lines.push(`• Ignorados (já existiam): ${report.skipped}`);
  if (report.exact_duplicates > 0) lines.push(`• Duplicidades exatas: ${report.exact_duplicates}`);
  if (report.probable_duplicates > 0) lines.push(`• Possíveis duplicidades guardadas: ${report.probable_duplicates}`);
  if (report.pending_review > 0) lines.push(`• Em revisão: ${report.pending_review}`);
  if (report.invalid > 0) lines.push(`• Ilegíveis: ${report.invalid}`);
  if (report.failed > 0) lines.push(`• Falhas: ${report.failed}`);
  lines.push("");
  lines.push(`Despesas: ${BRL.format(report.total_expense)} · Receitas: ${BRL.format(report.total_income)}`);
  if (report.total_transfer > 0) lines.push(`Transferências: ${BRL.format(report.total_transfer)}`);
  if (report.total_refund > 0) lines.push(`Estornos: ${BRL.format(report.total_refund)}`);
  return lines.join("\n");
}

/**
 * Confirma os itens novos de um lote estagiado e devolve o relatório completo.
 * `item_ids` vazio ⇒ confirma tudo que está pronto (sem duplicidade e sem issue).
 */
export async function confirmBatch(sb: SupabaseClient, args: {
  user_id: string;
  document_id: string;
  item_ids?: string[] | null;
}): Promise<ImportReport> {
  const empty: ImportReport = {
    ok: false, imported: 0, skipped: 0, failed: 0, exact_duplicates: 0, probable_duplicates: 0,
    pending_review: 0, invalid: 0, total_expense: 0, total_income: 0, total_transfer: 0,
    total_refund: 0, transaction_ids: [], ignored_item_ids: [],
  };

  const { data: doc } = await sb.from("document_imports")
    .select("id, counters").eq("id", args.document_id).eq("user_id", args.user_id).maybeSingle();
  const counters = ((doc as any)?.counters ?? {}) as Record<string, number>;

  let itemIds = args.item_ids ?? [];
  if (itemIds.length === 0) {
    const { data: rows } = await sb.from("extracted_items")
      .select("id, duplicate_reason, confidence")
      .eq("document_id", args.document_id)
      .eq("user_id", args.user_id)
      .eq("status", "needs_review")
      .is("transaction_id", null);
    itemIds = ((rows ?? []) as any[])
      .filter((row) => !row.duplicate_reason && (row.confidence?.issues ?? []).length === 0)
      .map((row) => String(row.id));
  }

  if (itemIds.length === 0) {
    return {
      ...empty,
      ok: true,
      exact_duplicates: counters.exact_duplicate ?? 0,
      probable_duplicates: counters.probable_duplicate ?? 0,
      pending_review: counters.needs_review ?? 0,
      invalid: counters.invalid ?? 0,
      error: "nenhum_item_novo",
    };
  }

  const { data, error } = await sb.rpc("confirm_document_import", {
    p_document_id: args.document_id,
    p_item_ids: itemIds,
    p_user_id: args.user_id,
  });
  if (error) return { ...empty, error: error.message.slice(0, 200) };

  const result = (data ?? {}) as any;
  if (result.ok !== true) {
    return { ...empty, error: String(result.error ?? "confirm_failed"), details: result };
  }

  const created = Array.isArray(result.created) ? result.created : [];
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];

  // Totais reais do que foi gravado (não da estimativa da prévia).
  const { data: confirmedRows } = await sb.from("extracted_items")
    .select("type, amount, movement_kind, transaction_id")
    .eq("document_id", args.document_id)
    .eq("user_id", args.user_id)
    .eq("status", "confirmed");

  let total_expense = 0, total_income = 0, total_transfer = 0, total_refund = 0;
  for (const row of ((confirmedRows ?? []) as any[])) {
    const amount = Number(row.amount ?? 0);
    if (row.movement_kind === "internal_transfer") total_transfer += amount;
    else if (row.movement_kind === "refund") total_refund += amount;
    else if (row.type === "income") total_income += amount;
    else total_expense += amount;
  }

  const { count: pending } = await sb.from("extracted_items")
    .select("id", { count: "exact", head: true })
    .eq("document_id", args.document_id)
    .eq("user_id", args.user_id)
    .in("status", ["needs_review", "duplicate_suspect"]);

  return {
    ok: true,
    imported: Number(result.created_count ?? created.length),
    skipped: skipped.length + (counters.exact_duplicate ?? 0),
    failed: errors.length,
    exact_duplicates: counters.exact_duplicate ?? 0,
    probable_duplicates: counters.probable_duplicate ?? 0,
    pending_review: Number(pending ?? 0),
    invalid: counters.invalid ?? 0,
    total_expense, total_income, total_transfer, total_refund,
    transaction_ids: created.map((row: any) => String(row.transaction_id)),
    ignored_item_ids: skipped.map((row: any) => String(row.item_id)),
    details: errors.length ? { errors } : null,
  };
}
