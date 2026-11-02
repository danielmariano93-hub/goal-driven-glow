// Caso real de 02/11: "R$ 1.291,82 em 1 dia (01/11)". Só R$ 108 foram gastos naquele dia; o resto é cartão e parcelas
// (inclusive parcelas antecipadas) que entram pelo mês da fatura e não têm um "dia do gasto".
import { describe, expect, it } from "vitest";
import { cardCompetenceSpend, grossDailySpend, monthlyChartCaption } from "@/lib/reports/intelligent/whatsappChart";
import type { IntelligentReport } from "@/lib/reports/intelligent/types";
import type { TransactionRow } from "@/lib/engine/facts";

const period = { start: "2026-11-01", end: "2026-11-02", label: "novembro até 02/11" };
const report = {
  period,
  highlights: [],
  payload: {
    series: [
      { label: "01/11", date: "2026-11-01", expense: 0, income: 0, cumulativeExpense: 0 },
      { label: "02/11", date: "2026-11-02", expense: 0, income: 0, cumulativeExpense: 0 },
    ],
  },
} as unknown as IntelligentReport;

const base = {
  account_id: "a1", category_id: null, status: "confirmed" as const, transfer_group_id: null, settles_card_id: null,
  movement_kind: "transaction", description: "x",
};
const card = { ...base, payment_method: "credit_card", credit_card_id: "c1", account_id: null };
const txs = [
  { ...base, id: "zig", type: "expense", amount: 108, occurred_at: "2026-11-01", payment_method: "account", credit_card_id: null, competence_date: null },
  { ...card, id: "claude", type: "expense", amount: 129.9, occurred_at: "2026-10-27", competence_date: "2026-11-01" },
  { ...card, id: "jim1", type: "expense", amount: 545.13, occurred_at: "2026-09-30", competence_date: "2026-11-01", economic_competence_date: "2026-11-01", installment_anticipated: true },
  { ...card, id: "jim2", type: "expense", amount: 508.79, occurred_at: "2026-07-30", competence_date: "2026-11-01", economic_competence_date: "2026-11-01", installment_anticipated: true },
] as unknown as TransactionRow[];

describe("gráfico dia a dia: cartão e parcelas ficam fora das barras", () => {
  it("só o gasto com data própria entra nas barras", () => {
    expect(grossDailySpend(report, txs)).toEqual([108, 0]);
  });

  it("cartão e parcelas somam em bloco separado e o total do período fecha com a competência", () => {
    expect(cardCompetenceSpend(report, txs)).toEqual({ total: 1183.82, count: 3 });
  });

  it("a mensagem não atribui R$ 1.291,82 a um dia e explica o bloco do cartão", () => {
    const text = monthlyChartCaption(report, null, txs).replace(/\u00a0/g, " ");
    expect(text).toContain("Gastos com data própria (conta, Pix, dinheiro): R$ 108,00 em 1 dia.");
    expect(text).toContain("Maior dia: R$ 108,00 em 01/11.");
    expect(text).toContain("Cartão e parcelas do período: R$ 1.183,82");
    expect(text).toContain("sem um dia específico");
    expect(text).toContain("Total do período: R$ 1.291,82.");
    expect(text).not.toMatch(/Maior dia: R\$ 1\.291,82/);
  });
});
