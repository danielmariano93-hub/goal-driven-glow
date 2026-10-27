import { describe, expect, it } from "vitest";
import { computeCommitmentAgenda, dueDateForCompetence } from "@/lib/engine/commitmentAgenda";

// Cartão Itaú: fecha dia 24 e vence dia 1. Competência = mês de referência.
// A fatura de outubro vence 01/11 (e está paga); as parcelas da competência novembro vencem 01/12.
describe("vencimento de competência de cartão", () => {
  it("vence no mês seguinte à referência quando o vencimento é antes/no fechamento", () => {
    expect(dueDateForCompetence("2026-11-01", 1, 24)).toBe("2026-12-01");
    expect(dueDateForCompetence("2026-12-01", 1, 24)).toBe("2027-01-01");
  });
  it("vence no mesmo mês quando o vencimento vem depois do fechamento", () => {
    expect(dueDateForCompetence("2026-11-01", 15, 5)).toBe("2026-11-15");
  });
  it("sem dia de fechamento mantém o comportamento anterior", () => {
    expect(dueDateForCompetence("2026-11-01", 1)).toBe("2026-11-01");
  });

  it("parcelas da competência novembro NÃO entram em 01/11 (fatura de outubro já paga)", () => {
    const agenda = computeCommitmentAgenda({
      recurring: [], txs: [],
      cards: [{ id: "c1", name: "Cartão Itaú", due_day: 1, closing_day: 24 }],
      statements: [{ id: "s1", credit_card_id: "c1", competence_month: "2026-10-01", due_date: "2026-11-01", status: "paid", stated_total: 0, paid_amount: 4579.9, outstanding_amount: 0 }] as never,
      installments: [{ id: "i1", credit_card_id: "c1", competence_month: "2026-11-01", status: "scheduled", amount: 1532.08, absorbed_by_statement_id: null }] as never,
      today: new Date("2026-10-27T12:00:00-03:00"), horizonDays: 60,
    } as never);
    const items = (agenda as any).items ?? agenda;
    const parcel = items.find((i: any) => i.source === "card_installment");
    expect(parcel?.date).toBe("2026-12-01");
    expect(items.filter((i: any) => i.date === "2026-11-01" && i.source === "card_installment")).toHaveLength(0);
  });
});
