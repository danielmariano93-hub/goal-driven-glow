import { describe, expect, it } from "vitest";
import { computeDebtStatus } from "@/lib/engine/debtStatus";

// Caso real: "Celular", parcela de R$ 500 com vencimento dia 27, 5 de 21 pagas.
const debt = {
  id: "celular", name: "Celular", status: "active",
  outstanding_balance: 8000, original_amount: 10500, installment_amount: 500,
  installments_total: 21, installments_paid: 5, due_day: 27,
} as never;

const situationOn = (today: string) =>
  computeDebtStatus({ debts: [debt], payments: [], today, dueSoonDays: 7 } as never).breakdown[0]!;

describe("parcela que vence hoje não está em atraso", () => {
  it("no dia do vencimento é 'vence hoje'", () => {
    const item = situationOn("2026-10-27");
    expect(item.situation).toBe("vence_em_breve");
    expect(item.days_to_due).toBe(0);
    expect(item.overdue_installments).toBe(0);
    expect(item.overdue_amount).toBe(0);
  });
  it("no dia seguinte, sem pagamento, passa a em atraso", () => {
    const item = situationOn("2026-10-28");
    expect(item.situation).toBe("em_atraso");
    expect(item.overdue_installments).toBe(1);
    expect(item.overdue_amount).toBe(500);
    expect(item.days_overdue).toBe(1);
  });
  it("na véspera ainda é 'vence em breve'", () => {
    expect(situationOn("2026-10-26").situation).toBe("vence_em_breve");
  });
});
