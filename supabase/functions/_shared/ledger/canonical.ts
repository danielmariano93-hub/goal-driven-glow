// Camada canônica de contabilização de documentos (fonte única de verdade).
//
// ESTE ARQUIVO É ESPELHADO em supabase/functions/_shared/ledger/canonical.ts.
// Qualquer alteração precisa ser aplicada nos dois (teste de contrato garante).
//
// Regras contábeis (gestão financeira pessoal):
//  1. Compra no cartão: reconhece consumo na data da compra, aumenta a obrigação
//     do cartão e NÃO movimenta conta corrente.
//  2. Importação/fechamento de fatura: reconcilia; não cria despesa nova.
//  3. Pagamento de fatura: reduz caixa e passivo; não é consumo.
//  4. Transferência própria, principal e amortização de empréstimo: neutros em resultado.

export type DocumentKind =
  | "receipt" | "invoice" | "statement" | "list"
  | "non_financial" | "illegible" | "unknown";

export type Ledger = "bank_account" | "credit_card" | "debt" | "cash" | "payable";

export type MovementKindLike =
  | "transaction" | "refund" | "internal_transfer"
  | "investment_application" | "investment_redemption" | "investment_yield"
  | "loan_proceeds" | "debt_payment" | "card_payment" | "fee" | "interest";

export type CanonicalItemInput = {
  type: "income" | "expense";
  amount: number;
  occurred_at: string;
  description?: string | null;
  movement_kind?: string | null;
  payment_method?: "account" | "credit_card" | null;
  account_id?: string | null;
  credit_card_id?: string | null;
  purchase_date?: string | null;
  competence_date?: string | null;
  installments_total?: number | null;
  installment_number?: number | null;
};

export type CanonicalMovement = {
  document_kind: DocumentKind;
  movement_kind: MovementKindLike;
  ledger: Ledger;
  source_id: string;
  cash_effect: number;      // -1 saída, +1 entrada, 0 neutro
  result_effect: number;    // -1 consumo, +1 receita, 0 neutro
  liability_effect: number; // +1 aumenta obrigação, -1 reduz, 0 neutro
  account_id: string | null;
  credit_card_id: string | null;
  recognition_date: string; // data de competência do reconhecimento
  confidence: number;
  reasons: string[];
  pending_fields: string[];
  blocks: string[];
};

/** Documento de cartão: itens pertencem ao cartão, nunca à conta corrente. */
export function isCardDocument(kind: DocumentKind | string | null | undefined): boolean {
  return String(kind ?? "") === "invoice";
}

/** Saldo bancário só é aceito em documento bancário compatível. */
export function allowsBankBalance(kind: DocumentKind | string | null | undefined): boolean {
  return String(kind ?? "") === "statement";
}

/** Ledger obrigatório a partir do tipo de documento + meio de pagamento. */
export function resolveLedger(kind: DocumentKind | string, item: CanonicalItemInput): Ledger {
  if (isCardDocument(kind)) return "credit_card";
  const mk = String(item.movement_kind ?? "transaction");
  if (mk === "debt_payment" || mk === "loan_proceeds") return "debt";
  if (item.credit_card_id || item.payment_method === "credit_card") return "credit_card";
  if (item.account_id || item.payment_method === "account") return "bank_account";
  return "cash";
}

const NEUTRAL_RESULT = new Set<string>([
  "internal_transfer", "card_payment", "debt_payment", "loan_proceeds",
  "investment_application", "investment_redemption",
]);

export function buildCanonicalMovement(args: {
  document_kind: DocumentKind | string;
  item: CanonicalItemInput;
  source_id: string;
  confidence?: number;
}): CanonicalMovement {
  const kind = String(args.document_kind ?? "unknown") as DocumentKind;
  const item = args.item;
  const ledger = resolveLedger(kind, item);
  const mk = String(item.movement_kind ?? "transaction") as MovementKindLike;
  const reasons: string[] = [];
  const pending_fields: string[] = [];
  const blocks: string[] = [];

  let account_id = item.account_id ?? null;
  let credit_card_id = item.credit_card_id ?? null;

  // INVARIANTE 1 — item de cartão nunca usa conta como fonte de caixa.
  if (ledger === "credit_card" && mk !== "card_payment") {
    if (account_id) reasons.push("account_stripped_for_card_ledger");
    account_id = null;
    if (!credit_card_id) {
      pending_fields.push("credit_card_id");
      blocks.push("missing_credit_card");
    }
  }
  if (ledger === "bank_account" && !account_id) {
    pending_fields.push("account_id");
    blocks.push("missing_account");
  }

  // INVARIANTE 2 — pagamento de fatura: sai da conta, abate cartão, sem consumo.
  const isCardPayment = mk === "card_payment";
  if (isCardPayment) {
    if (!account_id) { pending_fields.push("account_id"); blocks.push("missing_payment_account"); }
    if (!credit_card_id) { pending_fields.push("credit_card_id"); blocks.push("missing_credit_card"); }
  }

  const sign = item.type === "income" ? 1 : -1;
  const neutralResult = NEUTRAL_RESULT.has(mk);

  let cash_effect = 0;
  if (isCardPayment) cash_effect = -1;
  else if (ledger === "credit_card") cash_effect = 0;
  else cash_effect = sign;

  let liability_effect = 0;
  if (ledger === "credit_card" && !isCardPayment) liability_effect = item.type === "expense" ? 1 : -1;
  else if (isCardPayment) liability_effect = -1;
  else if (ledger === "debt") liability_effect = mk === "loan_proceeds" ? 1 : -1;

  const result_effect = neutralResult ? 0 : sign;

  // INVARIANTE 3/4 — competência: cartão reconhece na data da compra.
  const recognition_date = (ledger === "credit_card" && item.purchase_date)
    ? item.purchase_date
    : (item.competence_date ?? item.occurred_at);

  // INVARIANTE 5 — parcela histórica nunca é presumida paga.
  if ((item.installment_number ?? 0) > 1) reasons.push("historical_installments_require_confirmation");

  if (!args.source_id) blocks.push("missing_source_id");

  return {
    document_kind: kind,
    movement_kind: mk,
    ledger,
    source_id: args.source_id,
    cash_effect,
    result_effect,
    liability_effect,
    account_id,
    credit_card_id,
    recognition_date,
    confidence: args.confidence ?? 0.8,
    reasons,
    pending_fields: [...new Set(pending_fields)],
    blocks: [...new Set(blocks)],
  };
}

/** Normaliza a linha que será persistida em extracted_items, aplicando invariantes. */
export function applyLedgerInvariants<T extends Record<string, unknown>>(
  documentKind: DocumentKind | string,
  row: T,
): T {
  if (!isCardDocument(documentKind)) return row;
  const mk = String(row.movement_kind ?? "transaction");
  if (mk === "card_payment") return row;
  return {
    ...row,
    account_id: null,
    payment_method: "credit_card",
  } as T;
}

/** Motivos de bloqueio traduzidos para o usuário (pt-BR simples). */
export const BLOCK_MESSAGES: Record<string, string> = {
  missing_credit_card: "Escolha o cartão desta fatura para continuar.",
  missing_account: "Escolha a conta deste lançamento para continuar.",
  missing_payment_account: "Diga de qual conta saiu o pagamento da fatura.",
  missing_source_id: "Não consegui identificar a origem deste item. Reenvie o documento.",
  material_difference: "A soma dos itens não bate com o total informado. Revise antes de confirmar.",
};

/** Precedência de período: metadata → competência → datas dos itens. */
export function derivePeriod(args: {
  metadata_start?: string | null;
  metadata_end?: string | null;
  dates: Array<string | null | undefined>;
}): { start: string | null; end: string | null; source: "metadata" | "items" | "none" } {
  if (args.metadata_start && args.metadata_end) {
    return { start: args.metadata_start, end: args.metadata_end, source: "metadata" };
  }
  const valid = args.dates
    .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (valid.length === 0) {
    return { start: args.metadata_start ?? null, end: args.metadata_end ?? null, source: "none" };
  }
  return {
    start: args.metadata_start ?? valid[0],
    end: args.metadata_end ?? valid[valid.length - 1],
    source: "items",
  };
}

/** Divergência material entre total informado e soma dos itens (tolerância documentada). */
export const RECONCILIATION_TOLERANCE = 0.05;

export function reconciliationDiff(totalInformed: number | null, itemsSum: number): {
  difference: number | null;
  material: boolean;
} {
  if (totalInformed == null || !Number.isFinite(totalInformed)) return { difference: null, material: false };
  const diff = Math.round((totalInformed - itemsSum) * 100) / 100;
  return { difference: diff, material: Math.abs(diff) > RECONCILIATION_TOLERANCE };
}
