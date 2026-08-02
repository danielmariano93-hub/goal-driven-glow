// Contrato canônico de importação em lote — `import_item.v2`.
//
// Fonte única usada por TODAS as entradas em lote (JSON no chat, PDF, imagem,
// CSV, OFX, WhatsApp, MCP). Cada item preserva sua própria data, natureza
// contábil, destino (conta/cartão) e referência externa. Nada aqui converte
// tudo em income/expense: o `movement_kind` sobrevive até o ledger.

export const MOVEMENT_KINDS = [
  "transaction",
  "refund",
  "internal_transfer",
  "investment_application",
  "investment_redemption",
  "investment_yield",
  "loan_proceeds",
  "card_payment",
  "external_transfer_in",
  "external_transfer_out",
] as const;

export const IMPORT_ITEM_CONTRACT = "import_item.v2";

export type MovementKind = typeof MOVEMENT_KINDS[number];

export type ImportItemStatus =
  | "new"
  /** linha repetida legítima: idêntica a outra da MESMA origem, não é duplicidade */
  | "repeated_legitimate"
  | "exact_duplicate"
  | "probable_duplicate"
  | "needs_review"
  | "invalid";

export type ImportItem = {
  /** posição estável na origem (linha do documento / índice do JSON) */
  ordinal: number;
  /** data de competência do lançamento (por item, nunca herdada do lote quando informada) */
  occurred_at: string | null;
  /** data bancária real (caixa) — quando o dinheiro entrou/saiu da conta */
  posted_at: string | null;
  /** qualidade da data bancária: statement (lido do extrato) | import | inferred | manual */
  posted_at_source: "statement" | "import" | "inferred" | "manual" | null;
  /** data da compra no cartão (competência de fatura) */
  purchase_date: string | null;
  /** sempre positivo — o sinal vive em `type` */
  amount: number;
  type: "income" | "expense";
  movement_kind: MovementKind;
  description: string;
  raw_description: string | null;
  merchant: string | null;
  category_hint: string | null;
  account_hint: string | null;
  card_hint: string | null;
  payment_method: "account" | "credit_card" | null;
  installments_total: number | null;
  installment_number: number | null;
  external_id: string | null;
  bank_reference: string | null;
  /** documento/lote de origem — identidade da linha junto com `source_line_index` */
  source_document_id: string | null;
  /** índice da linha na origem: preserva linhas repetidas legítimas */
  source_line_index: number | null;
  /** vínculo com o lançamento original quando o item é estorno/reembolso */
  reverses_external_id: string | null;
  confidence: number;
  /** motivos legíveis quando o item precisa de revisão ou é inválido */
  issues: string[];
};

export type ClassifiedImportItem = ImportItem & {
  status: ImportItemStatus;
  /** motivo estruturado da classificação, sempre explicável ao usuário */
  reason_code: string | null;
  duplicate_of: string | null;
};

type KindRule = { kind: MovementKind; type?: "income" | "expense"; method?: "account" | "credit_card" };

/**
 * Dicionário de naturezas aceitas na entrada. Aceita os nomes canônicos e os
 * termos em português usados por usuários e por extratos brasileiros.
 */
const KIND_ALIASES: Array<{ match: RegExp; rule: KindRule }> = [
  { match: /^(refund|estorno|reembolso|devolucao|devolução|chargeback)$/i, rule: { kind: "refund", type: "income" } },
  { match: /^(card_payment|pagamento_fatura|pagamento_de_fatura|pagamento_cartao|pagamento_do_cartao)$/i, rule: { kind: "card_payment", type: "expense", method: "account" } },
  { match: /^(internal_transfer|transferencia_interna|transferencia|transferência)$/i, rule: { kind: "internal_transfer" } },
  { match: /^(transferencia_enviada|transferência_enviada|transfer_out)$/i, rule: { kind: "internal_transfer", type: "expense" } },
  { match: /^(transferencia_recebida|transferência_recebida|transfer_in)$/i, rule: { kind: "internal_transfer", type: "income" } },
  { match: /^(external_transfer_out|pix_enviado|ted_enviada|doc_enviado|transferencia_para_terceiro|transferência_para_terceiro)$/i, rule: { kind: "external_transfer_out", type: "expense", method: "account" } },
  { match: /^(external_transfer_in|pix_recebido|ted_recebida|doc_recebido|transferencia_de_terceiro|transferência_de_terceiro)$/i, rule: { kind: "external_transfer_in", type: "income", method: "account" } },
  { match: /^(investment_application|aplicacao|aplicação|investimento)$/i, rule: { kind: "investment_application", type: "expense" } },
  { match: /^(investment_redemption|resgate)$/i, rule: { kind: "investment_redemption", type: "income" } },
  { match: /^(investment_yield|rendimento|rendimentos|juros_recebidos)$/i, rule: { kind: "investment_yield", type: "income" } },
  { match: /^(loan_proceeds|emprestimo|empréstimo|credito_de_emprestimo|crédito_de_empréstimo)$/i, rule: { kind: "loan_proceeds", type: "income" } },
  { match: /^(compra_cartao|compra_no_cartao|credit_card_purchase)$/i, rule: { kind: "transaction", type: "expense", method: "credit_card" } },
  { match: /^(expense|despesa|saida|saída|debito|débito|gasto)$/i, rule: { kind: "transaction", type: "expense" } },
  { match: /^(income|receita|entrada|credito|crédito|ganho)$/i, rule: { kind: "transaction", type: "income" } },
  { match: /^(transaction|lancamento|lançamento)$/i, rule: { kind: "transaction" } },
];

/** Resolve `movement_kind` + `type` + método a partir de `tipo`/`movimento` crus. */
export function resolveNature(rawType: unknown, rawKind: unknown): KindRule {
  const candidates = [rawKind, rawType]
    .map((v) => String(v ?? "").trim().replace(/\s+/g, "_"))
    .filter(Boolean);
  let result: KindRule = { kind: "transaction" };
  // O tipo entra primeiro (define income/expense); a natureza sobrepõe depois.
  for (const raw of candidates.reverse()) {
    const found = KIND_ALIASES.find((entry) => entry.match.test(raw));
    if (!found) continue;
    result = {
      kind: found.rule.kind === "transaction" ? result.kind : found.rule.kind,
      type: found.rule.type ?? result.type,
      method: found.rule.method ?? result.method,
    };
  }
  return result;
}

/** Naturezas que não são consumo: nunca entram como gasto/receita comportamental. */
export const NON_CONSUMPTION_KINDS: MovementKind[] = [
  "internal_transfer",
  "investment_application",
  "investment_redemption",
  "card_payment",
  "loan_proceeds",
  "external_transfer_in",
  "external_transfer_out",
];

export function isMovementKind(value: unknown): value is MovementKind {
  return typeof value === "string" && (MOVEMENT_KINDS as readonly string[]).includes(value);
}

/** Data ISO (YYYY-MM-DD) a partir de formatos BR/ISO comuns. Null quando ilegível. */
export function parseItemDate(raw: unknown, fallbackYear?: number): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (br) {
    const day = br[1].padStart(2, "0");
    const month = br[2].padStart(2, "0");
    let year = br[3] ?? String(fallbackYear ?? new Date().getUTCFullYear());
    if (year.length === 2) year = `20${year}`;
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
    return `${year}-${month}-${day}`;
  }
  return null;
}
