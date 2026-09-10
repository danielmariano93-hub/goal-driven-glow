// CONTRATO DE PROJEÇÃO — report_projection.v1
// ===========================================
// Fonte única dos campos que o loader do relatório precisa carregar de cada
// tabela, e dos campos que os motores canônicos EXIGEM para produzir número
// correto.
//
// Causa-raiz do incidente de 06–10/09/2026: o `.select(...)` de
// `credit_card_installments` pedia `installments_total` (coluna inexistente) e
// NÃO pedia `legacy_transaction_id` / `absorbed_by_statement_id` — campos que o
// `computeCardExposure()` usa para não contar a mesma parcela duas vezes.
// Resultado: HTTP 500 e, se corrigido só removendo a coluna inválida, número
// silenciosamente errado.
//
// Regra: quem muda o SELECT muda AQUI. O teste de contrato
// (`src/test/report-projection-contract.test.ts`) valida, sem tocar em
// produção:
//   1) todo campo projetado existe de fato no schema atual;
//   2) todo campo exigido pelo motor está projetado.
export const REPORT_SCHEMA_CONTRACT_VERSION = "report_projection.v1";

/** Campos projetados por tabela (o que o loader realmente pede à Data API). */
export const REPORT_PROJECTIONS = {
  categories: ["id", "name"],
  accounts: ["id", "name", "type", "opening_balance", "active"],
  account_balance_snapshots: [
    "account_id",
    "balance",
    "balance_date",
    "status",
    "anchor_kind",
    "source_document_id",
    "reconciliation_delta",
  ],
  goals: ["id", "name", "target_amount", "status", "target_date"],
  goal_contributions: ["goal_id", "amount"],
  credit_cards: ["id", "name", "closing_day", "due_day", "active"],
  credit_card_statements: [
    "id",
    "credit_card_id",
    "competence_month",
    "due_date",
    "stated_total",
    "paid_amount",
    // Sem estes dois o relatório calculava dívida de cartão com visão parcial
    // da fatura (saldo em aberto e divergência de conciliação).
    "outstanding_amount",
    "reconciliation_difference",
    "status",
    "requires_manual_review",
  ],
  credit_card_installments: [
    "id",
    "credit_card_id",
    "purchase_id",
    "installment_number",
    "competence_month",
    "amount",
    "due_date",
    "status",
    // Anti-dupla-contagem: parcela já absorvida por fatura fechada/paga e
    // parcela que já existe no ledger legado.
    "legacy_transaction_id",
    "absorbed_by_statement_id",
  ],
} as const satisfies Record<string, readonly string[]>;

export type ReportProjectionTable = keyof typeof REPORT_PROJECTIONS;

/** String pronta para `.select(...)`. */
export function projection(table: ReportProjectionTable): string {
  return REPORT_PROJECTIONS[table].join(",");
}

/**
 * Campos que os tipos canônicos consomem e que, se ausentes, produzem número
 * errado (não erro). Espelha `CardStatementRow` / `CardInstallmentRow` de
 * `_shared/finance-core/cardExposure.ts` e o contrato de metas do engine.
 */
export const ENGINE_REQUIRED_FIELDS = {
  credit_card_statements: [
    "id",
    "credit_card_id",
    "competence_month",
    "due_date",
    "stated_total",
    "paid_amount",
    "outstanding_amount",
    "reconciliation_difference",
    "status",
  ],
  credit_card_installments: [
    "id",
    "credit_card_id",
    "competence_month",
    "amount",
    "status",
    "legacy_transaction_id",
    "absorbed_by_statement_id",
    "purchase_id",
    "installment_number",
  ],
  credit_cards: ["id", "name", "closing_day", "due_day"],
  goals: ["id", "name", "target_amount", "status"],
  goal_contributions: ["goal_id", "amount"],
  accounts: ["id", "name", "type", "opening_balance"],
} as const satisfies Partial<Record<ReportProjectionTable, readonly string[]>>;
