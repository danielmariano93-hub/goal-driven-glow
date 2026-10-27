// `installment_anticipation.v1` — antecipar parcela é liquidação de dívida:
// o consumo fica na competência em que a parcela venceria; a fatura segue
// mostrando quando foi cobrada.
import { describe, expect, it } from "vitest";
import {
  buildCarriedInstallmentIds,
  reportingCompetenceDate,
  type TransactionRow,
} from "@/lib/engine/facts";
import { computeCanonicalPeriodTotals, computeInstallmentAnticipation } from "@/lib/engine/canonicalFacts";

function tx(over: Partial<TransactionRow> & { id: string; amount: number }): TransactionRow {
  return {
    account_id: "", category_id: "cat-servicos", type: "expense", status: "confirmed",
    occurred_at: "2026-09-30", description: "JIM.COM", transfer_group_id: null,
    payment_method: "credit_card", credit_card_id: "card-1", competence_date: "2026-10-01",
    movement_kind: "transaction", installment_number: null, installments_total: null,
    ...over,
  } as TransactionRow;
}

// JIM 30/09 em 6x, as 6 parcelas cobradas na fatura de outubro (antecipação).
const jim = [1, 2, 3, 4, 5, 6].map((k) => tx({
  id: `jim-${k}`, amount: 545.13, installment_number: k, installments_total: 6,
  purchase_group_id: "g-jim", purchase_date: "2026-09-30",
  installment_anticipated: k > 1,
  economic_competence_date: k > 1 ? `2026-${String(9 + k).padStart(2, "0")}-01`.replace("2026-13", "2027-01").replace("2026-14", "2027-02").replace("2026-15", "2027-03") : null,
}));

describe("reportingCompetenceDate", () => {
  it("parcela antecipada usa a competência econômica; a fatura segue a cobrada", () => {
    expect(reportingCompetenceDate(jim[0])).toBe("2026-10-01");
    expect(reportingCompetenceDate(jim[1])).toBe("2026-11-01");
    expect(reportingCompetenceDate(jim[5])).toBe("2027-03-01");
    expect(jim[1].competence_date).toBe("2026-10-01");
  });

  it("sem competência econômica, nada muda", () => {
    expect(reportingCompetenceDate(tx({ id: "x", amount: 1 }))).toBe("2026-10-01");
  });
});

describe("consumo do mês", () => {
  it("outubro conta só a parcela 1; as antecipadas vão para o mês em que venceriam", () => {
    const oct = computeCanonicalPeriodTotals(jim, { start: "2026-10-01", end: "2026-10-31" });
    expect(oct.expense).toBe(545.13);
    const nov = computeCanonicalPeriodTotals(jim, { start: "2026-11-01", end: "2026-11-30" });
    expect(nov.expense).toBe(545.13);
    const total = ["10", "11", "12"].reduce((s, m) =>
      s + computeCanonicalPeriodTotals(jim, { start: `2026-${m}-01`, end: `2026-${m}-31` }).expense, 0);
    expect(Math.round(total * 100) / 100).toBe(1635.39);
  });
});

describe("computeInstallmentAnticipation", () => {
  it("soma as parcelas antecipadas na fatura em que foram cobradas", () => {
    const fact = computeInstallmentAnticipation(jim, { start: "2026-10-01", end: "2026-10-31" });
    expect(fact.count).toBe(5);
    expect(fact.amount).toBe(2725.65);
    expect(fact.purchases).toBe(1);
    expect(fact.by_economic_month.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
  });

  it("outro período não vê a antecipação", () => {
    expect(computeInstallmentAnticipation(jim, { start: "2026-11-01", end: "2026-11-30" }).amount).toBe(0);
  });
});

describe("parcela carregada x antecipada", () => {
  it("compra do ciclo antecipada: parcelas 2+ ficam fora da meta nos meses seguintes, não em outubro", () => {
    expect(buildCarriedInstallmentIds(jim).has("jim-1")).toBe(false);
  });
});
