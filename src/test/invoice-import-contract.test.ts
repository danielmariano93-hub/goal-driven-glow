import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("invoice import safety contract", () => {
  it("requires official total reconciliation before confirmation", () => {
    const migration = read("supabase/migrations/20260730030000_invoice_import_reconciliation.sql");
    const edge = read("supabase/functions/assistant-review-actions/index.ts");
    expect(migration).toContain("validate_invoice_import");
    expect(migration).toContain("abs(v_difference) > 0.05");
    expect(edge).toContain("invoice_not_reconciled");
  });

  it("never turns bill payments or informational rows into new transactions", () => {
    const migration = read("supabase/migrations/20260731120000_invoice_atomic_save_and_statement_payment.sql");
    expect(migration).toContain("NOT IN ('payment','informational')");
    expect(migration).toContain("IN ('payment','informational')");
    expect(migration).toContain("v_non_ledger_ids");
  });

  it("keeps the manual and imported installment journeys explicit", () => {
    const review = read("src/components/assessor/ReviewSheet.tsx");
    const manual = read("src/pages/Lancamentos.tsx");
    expect(review).toContain("Parcela nesta fatura");
    expect(review).toContain("Total de parcelas");
    expect(manual).toContain("Valor desta parcela");
    expect(manual).toContain("Compra estimada");
  });

  it("carries the previous invoice balance without duplicating an expense", () => {
    const migration = read("supabase/migrations/20260730235500_invoice_previous_balance_reconciliation.sql");
    const ingest = read("supabase/functions/assistant-ingest-document/index.ts");
    const review = read("src/components/assessor/ReviewSheet.tsx");
    expect(migration).toContain("coalesce(v_doc.invoice_previous_balance, 0) + v_activity");
    expect(migration).toContain("Saldo trazido do ciclo anterior, usado apenas na conciliação");
    expect(ingest).toContain("nunca o infira pela diferença matemática");
    expect(review).toContain("ele não será lançado como nova despesa");
  });
});
