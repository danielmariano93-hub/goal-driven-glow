import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeDebtStatus, buildDebtSchedule, type DebtScheduleRow } from "@/lib/engine/debtStatus";
import { computeCommitmentAgenda } from "@/lib/engine/commitmentAgenda";

const debt = {
  id: "d1", name: "Celular", creditor: "Robson", outstanding_balance: 8000, original_amount: 10500,
  installment_amount: 500, installments_total: 21, installments_paid: 5, due_day: 27, status: "active",
  first_due_date: "2026-05-27", start_date: null,
} as unknown as DebtScheduleRow;
const today = "2026-10-14";

describe("dívida com 1ª parcela informada", () => {
  it("5 pagas desde 27/05: setembro paga, outubro pendente (próxima)", () => {
    const sched = buildDebtSchedule(debt, [], today);
    expect(sched.installments[0].due_date).toBe("2026-05-27");
    expect(sched.installments[4].state).toBe("paga");
    expect(sched.installments[5].due_date).toBe("2026-10-27");
    expect(sched.installments[5].state).not.toBe("paga");
  });
  it("agenda de compromissos não marca outubro como pago", () => {
    const agenda = computeCommitmentAgenda({
      recurring: [], txs: [], debts: [debt as never], debtPayments: [], today: new Date(`${today}T12:00:00`),
    });
    const oct = agenda.items.find((i) => i.dedupKey === "debt:d1:2026-10");
    expect(oct?.payment_status).toBe("pending");
    expect(computeDebtStatus({ debts: [debt], payments: [], today }).breakdown[0].next_due_date).toBe("2026-10-27");
  });
  it("sem a 1ª parcela, o pagamento de 29/09 'cobre' o ciclo de 27/10 (o defeito original)", () => {
    const derived = { ...debt, first_due_date: null } as unknown as DebtScheduleRow;
    const payments = [{ debt_id: "d1", paid_at: "2026-09-29", amount: 500, amount_applied: 500, installments_covered: 1 }];
    const agenda = computeCommitmentAgenda({
      recurring: [], txs: [], debts: [derived as never], debtPayments: payments, today: new Date(`${today}T12:00:00`),
    });
    expect(agenda.items.find((i) => i.dedupKey === "debt:d1:2026-10")?.payment_status).toBe("paid");
  });
});

describe("fontes que leem dívidas carregam a data da 1ª parcela", () => {
  it("home-snapshot seleciona e repassa first_due_date", () => {
    const src = readFileSync("supabase/functions/home-snapshot/index.ts", "utf8");
    expect(src).toContain("start_date,first_due_date");
    expect(src).toContain("first_due_date: d.first_due_date");
  });
  it("lembretes (metrics) leem pagamentos de dívida", () => {
    expect(readFileSync("supabase/functions/_shared/engine/metrics.ts", "utf8")).toContain('from("debt_payments")');
  });
  it("editar a dívida preserva a 1ª parcela e permite informá-la", () => {
    const page = readFileSync("src/pages/Dividas.tsx", "utf8");
    expect(page).toContain("first_due_date: isInstallment && firstDue");
    expect(page).toContain("Vincular lançamento");
  });
});

describe("ajuste da próxima parcela", () => {
  const ajustada = { ...debt, next_installment_index: 6, next_installment_due: "2026-10-30", next_installment_amount: 520 } as unknown as DebtScheduleRow;

  it("lista de parcelas usa o novo vencimento/valor só na próxima parcela", () => {
    const sched = buildDebtSchedule(ajustada, [], today);
    const sexta = sched.installments[5];
    expect(sexta).toMatchObject({ due_date: "2026-10-30", amount: 520, adjusted: true });
    expect(sched.installments[6]).toMatchObject({ due_date: "2026-11-27", amount: 500 });
  });
  it("status e agenda seguem o ajuste", () => {
    expect(computeDebtStatus({ debts: [ajustada], payments: [], today }).breakdown[0].next_due_date).toBe("2026-10-30");
    const agenda = computeCommitmentAgenda({ recurring: [], txs: [], debts: [ajustada as never], debtPayments: [], today: new Date(`${today}T12:00:00`) });
    const item = agenda.items.find((i) => i.source === "debt_installment");
    expect(item).toMatchObject({ date: "2026-10-30", amount: 520, payment_status: "pending" });
  });
  it("ajuste para o passado vira atraso", () => {
    const atrasada = { ...ajustada, next_installment_due: "2026-10-10" } as unknown as DebtScheduleRow;
    const st = computeDebtStatus({ debts: [atrasada], payments: [], today }).breakdown[0];
    expect(st.situation).toBe("em_atraso");
    expect(st.days_overdue).toBe(4);
  });
  it("ajuste expira quando a parcela é paga (índice não coincide mais)", () => {
    const paga = { ...ajustada, installments_paid: 6 } as unknown as DebtScheduleRow;
    expect(buildDebtSchedule(paga, [], today).installments[5].adjusted).toBeFalsy();
  });
});
