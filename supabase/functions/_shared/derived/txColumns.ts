// Colunas de lançamento usadas pelas leituras derivadas do servidor.
// Espelha `TX_COLUMNS` de `src/lib/db/finance.ts` — nenhuma coluna inventada:
// pedir campo inexistente derruba a leitura inteira (erro do PostgREST).
export const TX_COLUMNS = [
  "id", "user_id", "account_id", "category_id", "type", "status", "amount",
  "occurred_at", "description", "notes", "emotional_trigger", "transfer_group_id",
  "created_at", "origin", "payment_method", "credit_card_id", "installment_number",
  "installments_total", "purchase_date", "competence_date", "purchase_group_id",
  "settles_card_id", "raw_description", "movement_kind", "friendly_description",
  "shared_expense_id", "split_transaction_role", "category_confidence",
  "category_source", "category_reason", "posted_at", "posted_at_source",
  "source_document_id", "behavioral_day", "investment_id", "superseded_by",
  "supersede_reason", "refund_of_transaction_id", "merchant_name",
].join(",");
