import { describe, expect, it } from "vitest";
import { computeCommitmentAgenda } from "@/lib/engine/commitmentAgenda";

// Caso real (Réveillon- Cartão): 4x de 1.566, 1ª parcela editada para 09/11, `due_day` ficou 1.
const debt = {
  id: "reveillon", name: "Réveillon- Cartão", status: "active",
  outstanding_balance: 6264, original_amount: 6264, installment_amount: 1566,
  installments_total: 4, installments_paid: 0, due_day: 1, first_due_date: "2026-11-09",
} as never;

describe("agenda respeita a data da 1ª parcela editada", () => {
  const agenda = computeCommitmentAgenda({
    recurring: [], txs: [], debts: [debt], horizonDays: 60, today: new Date("2026-11-03T12:00:00Z"),
  });
  const items = agenda.items.filter((i) => i.source === "debt_installment");
  it("a parcela continua em novembro, na data editada (não no dia 1 antigo)", () => {
    expect(items.map((i) => i.date)).toEqual(["2026-11-09", "2026-12-09"]);
  });
  it("o total do mês conta a parcela", () => {
    expect(items[0]!.amount).toBe(1566);
    expect(agenda.pendingItems.some((i) => i.date === "2026-11-09")).toBe(true);
  });
  it("sem 1ª parcela informada, segue pelo due_day (agenda derivada)", () => {
    const derived = computeCommitmentAgenda({
      recurring: [], txs: [], debts: [{ ...(debt as object), first_due_date: null } as never], horizonDays: 60,
      today: new Date("2026-11-03T12:00:00Z"),
    }).items.filter((i) => i.source === "debt_installment");
    expect(derived.every((i) => i.date.endsWith("-01"))).toBe(true);
  });
});
