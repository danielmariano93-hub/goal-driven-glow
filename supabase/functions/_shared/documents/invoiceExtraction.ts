// Ponte entre o parser determinístico de faturas e o contrato de extração.
import type { ExtractedItem, ExtractionResult } from "./types.ts";
import type { ParsedInvoice, ParsedInvoiceLine } from "./invoiceParser.ts";

export type DeterministicItem = ExtractedItem & {
  statement_section: string;
  is_future_installment: boolean;
};

function mapLine(line: ParsedInvoiceLine, fallbackDate: string): DeterministicItem {
  const isCredit = line.kind === "payment" || line.kind === "refund";
  const movement_kind: ExtractedItem["movement_kind"] = line.kind === "payment"
    ? "card_payment"
    : line.kind === "refund"
      ? "refund"
      : "transaction";
  return {
    type: isCredit ? "income" : "expense",
    description: line.description.slice(0, 200),
    amount: Math.abs(line.amount),
    occurred_at: line.date ?? fallbackDate,
    payment_method: "credit_card",
    account_hint: null,
    card_hint: null,
    category_hint: null,
    installments_total: null,
    installment_number: null,
    purchase_date: null,
    competence_date: null,
    confidence: { amount: 1, occurred_at: line.date ? 1 : 0.4, source: 1 },
    movement_kind,
    source_span: { section: line.section, parser: "deterministic" },
    statement_section: line.section,
    is_future_installment: line.section === "future_installments",
  };
}

/** Converte a leitura determinística em itens do pipeline padrão. */
export function invoiceToExtraction(
  parsed: ParsedInvoice,
  fallbackDate: string,
): { result: ExtractionResult & { items: DeterministicItem[] } } {
  return {
    result: {
      document_kind: "invoice",
      items: parsed.lines.map((l) => mapLine(l, fallbackDate)),
      notes: "leitura determinística da camada de texto",
    },
  };
}

/** Divide os itens em lotes do mesmo tamanho usado pela extração multimodal. */
export function chunkItems<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
