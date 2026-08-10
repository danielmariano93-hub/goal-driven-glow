// Identidade de linha e de reupload de extrato (`bank_cash_truth.v1`).
//
// ESTE ARQUIVO É ESPELHADO em supabase/functions/_shared/ledger/statementIdentity.ts.
//
// Dois requisitos que precisam valer AO MESMO TEMPO:
//  1. duas linhas idênticas dentro do MESMO extrato continuam duas (gêmeos
//     legítimos, ex.: duas cobranças Autopass de R$ 5,40 no mesmo dia);
//  2. reimportar o MESMO arquivo não pode criar nenhuma movimentação nova.
//
// Por isso a identidade da linha NÃO pode depender do `document_id`: cada
// reupload gera um novo documento. A âncora estável é o conteúdo do arquivo
// (sha256) + o ordinal da linha + o valor.

/** Origens de `posted_at` com autoridade de data bancária real. Contrato único. */
export const BANK_POSTING_SOURCES = ["statement", "bank", "ofx", "reconciliation"] as const;

export type BankPostingSource = (typeof BANK_POSTING_SOURCES)[number];

const BANK_POSTING_SET = new Set<string>(BANK_POSTING_SOURCES);

/** `posted_at_source` com autoridade bancária? Mesma definição usada no SQL. */
export function isBankPostingSource(source?: string | null): boolean {
  return BANK_POSTING_SET.has(String(source ?? "inferred"));
}

/**
 * Identidade estável de uma linha de extrato.
 * Usa o hash do arquivo quando disponível; sem hash, cai para o documento
 * (comportamento antigo) para não perder identidade dentro do mesmo import.
 */
export function statementLineFingerprint(input: {
  documentSha256?: string | null;
  documentId: string;
  ordinal: number;
  amount: number | string;
}): string {
  const sha = String(input.documentSha256 ?? "").trim();
  const stable = sha && !sha.startsWith("pending:") ? `sha:${sha}` : `doc:${input.documentId}`;
  const cents = Number(input.amount);
  const amount = Number.isFinite(cents) ? cents.toFixed(2) : "0.00";
  return `stmt:${stable}:${input.ordinal}:${amount}`;
}
