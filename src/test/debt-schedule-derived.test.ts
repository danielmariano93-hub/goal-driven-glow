import { describe, expect, it } from "vitest";
import { computeDebtStatus, buildDebtSchedule, type DebtScheduleRow } from "@/lib/engine/debtStatus";

// Dívida real do usuário: só informa dia de vencimento (10) e 18/35 parcelas pagas.
// Sem âncora derivada, o próximo vencimento seria projetado 18 meses à frente
// e o atraso do ciclo corrente nunca apareceria.
const pan: DebtScheduleRow = {
  id: "pan",
  name: "Banco Pan",
  status: "active",
  due_day: 10,
  start_date: null,
  first_due_date: null,
  installment_amount: 74.54,
  installments_total: 35,
  installments_paid: 18,
  outstanding_balance: 1267.18,
} as unknown as DebtScheduleRow;

describe("debt_status — agenda derivada por due_day", () => {
  it("acusa atraso quando o ciclo corrente já venceu sem pagamento", () => {
    const env = computeDebtStatus({ debts: [pan], payments: [], today: "2026-08-12" });
    const item = env.breakdown[0];
    expect(item.situation).toBe("em_atraso");
    expect(item.next_due_date).toBe("2026-08-10");
    expect(env.facts.overdue_count).toBe(1);
  });

  it("marca vencimento próximo antes do dia 10", () => {
    const env = computeDebtStatus({ debts: [pan], payments: [], today: "2026-08-06" });
    expect(env.breakdown[0].situation).toBe("vence_em_breve");
  });

  it("agenda expõe parcelas pagas, vencida e próximas com marcos", () => {
    const schedule = buildDebtSchedule(pan, [], "2026-08-12");
    expect(schedule.installments).toHaveLength(35);
    expect(schedule.installments.filter((i) => i.state === "paga")).toHaveLength(18);
    expect(schedule.installments[18].state).toBe("vencida");
    expect(schedule.overdue_count).toBeGreaterThan(0);
    expect(schedule.milestones).toContain(50);
  });

  it("pagamento do ciclo atual sem contador explícito deixa de manter a dívida em atraso", () => {
    const payments = [{
      debt_id: "pan",
      paid_at: "2026-08-11",
      amount: 74.54,
      amount_applied: 74.54,
      installments_covered: 0,
    }];
    const env = computeDebtStatus({ debts: [pan], payments, today: "2026-08-12" });
    const item = env.breakdown[0];
    expect(item.situation).toBe("em_dia");
    expect(item.next_due_date).toBe("2026-09-10");

    const schedule = buildDebtSchedule(pan, payments, "2026-08-12");
    expect(schedule.installments.filter((i) => i.state === "paga")).toHaveLength(19);
    expect(schedule.overdue_count).toBe(0);
    expect(schedule.next_due_date).toBe("2026-09-10");
  });
});
