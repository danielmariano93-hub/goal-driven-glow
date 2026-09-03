import { describe, expect, it } from "vitest";
import { computeCommitmentAgenda } from "@/lib/engine/commitmentAgenda";
import { computeDebtStatus } from "@/lib/engine/debtStatus";
import { civilAddDays, civilDueDate, civilDueDateInMonthOf } from "@/lib/engine/civilDate";

// Caso real (Banco Sim): parcela de 97,06 com vencimento dia 4, paga em 02/09.
const debt = {
  id: "banco-sim",
  name: "Banco Sim",
  status: "active",
  outstanding_balance: 1067.66,
  original_amount: 1164.72,
  installment_amount: 97.06,
  installments_total: 12,
  installments_paid: 1,
  due_day: 4,
} as never;

const payment = {
  id: "pay-1",
  debt_id: "banco-sim",
  amount: 97.06,
  amount_applied: 97.06,
  installments_covered: 1,
  paid_at: "2026-09-02",
};

describe("parcela paga não vira cobrança", () => {
  it("a agenda marca o ciclo pago e não soma no total pendente", () => {
    const agenda = computeCommitmentAgenda({
      recurring: [],
      txs: [],
      debts: [debt],
      debtPayments: [payment],
      horizonDays: 40,
      today: new Date("2026-09-02T12:00:00Z"),
    });
    const current = agenda.items.find((i) => i.date === "2026-09-04");
    expect(current?.payment_status).toBe("paid");
    expect(agenda.pendingItems.some((i) => i.date === "2026-09-04")).toBe(false);
    expect(agenda.totalExpense).toBe(97.06); // só a parcela de outubro
    expect(agenda.bySource.debt_installment).toBe(97.06);
  });

  it("o motor canônico aponta o próximo vencimento em outubro, sem atraso", () => {
    const status = computeDebtStatus({
      debts: [debt],
      payments: [payment],
      today: "2026-09-02",
    });
    const item = status.breakdown[0]!;
    expect(item.situation).toBe("em_dia");
    expect(item.next_due_date).toBe("2026-10-04");
    expect(item.overdue_installments).toBe(0);
  });

  it("data civil de vencimento não desloca em runtime UTC", () => {
    expect(civilDueDateInMonthOf("2026-09-02", 4)).toBe("2026-09-04");
    expect(civilDueDate(2026, 2, 31)).toBe("2026-02-28");
    expect(civilAddDays("2026-09-30", 1)).toBe("2026-10-01");
  });
});
