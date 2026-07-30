import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("financial accounting integration contract", () => {
  it("requires explicit confirmation before treating historical card installments as paid", () => {
    const migration = readProjectFile(
      "supabase/migrations/20260730020000_financial_accounting_cards_debts.sql",
    );
    const reviewSheet = readProjectFile(
      "src/components/assessor/ReviewSheet.tsx",
    );

    expect(migration).toContain("historical_installments_paid_assumption");
    expect(migration).toContain("reconcile_imported_installment_history");
    expect(reviewSheet).toContain("parcelas anteriores já foram pagas");
    expect(reviewSheet).toContain("reconcile_imported_installment_history");
  });

  it("keeps principal, interest and fees independently auditable for debt payments", () => {
    const migration = readProjectFile(
      "supabase/migrations/20260730020000_financial_accounting_cards_debts.sql",
    );

    expect(migration).toContain("record_debt_payment");
    expect(migration).toContain("principal_amount");
    expect(migration).toContain("interest_amount");
    expect(migration).toContain("fee_amount");
    expect(migration).toContain("'debt_payment'");
  });
});
