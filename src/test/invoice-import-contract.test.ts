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
    const edge = read("supabase/functions/assistant-review-actions/index.ts");
    expect(edge).toContain('row.statement_item_kind === "payment"');
    expect(edge).toContain('row.statement_item_kind === "informational"');
    expect(edge).toContain("nonLedgerIds");
  });

  it("keeps the manual and imported installment journeys explicit", () => {
    const review = read("src/components/assessor/ReviewSheet.tsx");
    const manual = read("src/pages/Lancamentos.tsx");
    expect(review).toContain("Parcela nesta fatura");
    expect(review).toContain("Total de parcelas");
    expect(manual).toContain("Valor desta parcela");
    expect(manual).toContain("Compra estimada");
  });
});
