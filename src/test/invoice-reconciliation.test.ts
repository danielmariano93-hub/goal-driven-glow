import { describe, expect, it } from "vitest";
import {
  classifyStatementItem,
  inferInstallmentDetails,
  invoiceReconciliation,
  summarizeInvoiceLines,
} from "@/lib/finance/invoice";

describe("credit-card invoice reconciliation", () => {
  it("infers current and total installments from common Brazilian labels", () => {
    expect(inferInstallmentDetails("LOJA EXEMPLO PARC 03/10")).toEqual({
      current: 3, total: 10, inferred: true,
    });
    expect(inferInstallmentDetails("COMPRA 4 de 12")).toEqual({
      current: 4, total: 12, inferred: true,
    });
  });

  it("subtracts refunds and bill payments instead of summing absolute values", () => {
    const summary = summarizeInvoiceLines([
      { amount: 100, type: "expense", description: "Compra" },
      { amount: 20, type: "income", description: "Estorno" },
      { amount: 30, type: "expense", description: "Pagamento da fatura" },
    ]);
    expect(summary).toMatchObject({ charges: 100, credits: 20, payments: 30, net: 50 });
  });

  it("classifies installments and informational totals safely", () => {
    expect(classifyStatementItem({ amount: 40, type: "expense", description: "Curso 02/08" })).toBe("installment");
    expect(classifyStatementItem({ amount: 500, type: "expense", description: "Total da fatura" })).toBe("informational");
  });

  it("uses a five-cent tolerance and blocks material differences", () => {
    expect(invoiceReconciliation(100, 99.96).reconciled).toBe(true);
    expect(invoiceReconciliation(100, 99.90)).toEqual({ difference: 0.1, reconciled: false });
  });
});

