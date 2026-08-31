import { describe, it, expect } from "vitest";
import { buildIntelligentReport } from "@/lib/reports/intelligent/engine";
import { computeGoalPerformanceAssessment } from "@/lib/engine/goalPerformanceAssessment";
import { groupByMonth, filterPeriod, byCategory, type ReportTxn } from "@/lib/reports/aggregations";
import { findMissingCompetenceSelects } from "../../scripts/check-tx-selects.mjs";
import type { TransactionRow } from "@/lib/engine/facts";

/**
 * `reporting_competence.v1` — uma só verdade por categoria.
 *
 * O incidente real: o relatório mostrava Transporte R$ 983,62 e o Nino, no
 * WhatsApp, R$ 2.389,99 para o mesmo mês. Causa: o relatório agregava por
 * `occurred_at` e o motor de metas por competência (cartão pelo mês da fatura).
 */

const CAT = "cat-transporte";

function tx(partial: Partial<TransactionRow> & { amount: number; occurred_at: string }): TransactionRow {
  return {
    id: partial.occurred_at + ":" + partial.amount,
    account_id: "acc-1",
    type: "expense",
    status: "confirmed",
    category_id: CAT,
    description: null,
    transfer_group_id: null,
    ...partial,
  } as unknown as TransactionRow;
}

/** Compra de cartão feita em julho, com competência (fatura) em agosto. */
const cardPurchaseJulyCompetenceAugust = tx({
  amount: 1000,
  occurred_at: "2026-07-28",
  competence_date: "2026-08-05",
  payment_method: "credit_card",
  credit_card_id: "card-1",
});

/** Débito comum de agosto — mesma data nas duas lentes. */
const cashAugust = tx({ amount: 400, occurred_at: "2026-08-10", competence_date: null });

const REFERENCE = new Date(Date.UTC(2026, 7, 31, 12));

const GOAL = {
  id: "goal-1",
  category_id: CAT,
  status: "active",
  period_type: "custom",
  frequency: "monthly",
  mode: "fixed",
  baseline_kind: "fixed",
  baseline_value: null,
  fixed_limit: 1200,
  computed_limit: 1200,
  reduction_pct: null,
  start_date: "2026-08-01",
  end_date: "2026-08-31",
  timezone: "America/Sao_Paulo",
  alerts: {},
} as never;

function report(transactions: TransactionRow[]) {
  return buildIntelligentReport({
    reportType: "custom",
    referenceDate: REFERENCE,
    customPeriod: { start: "2026-08-01", end: "2026-08-31" },
    transactions,
    categoryNames: { [CAT]: "Transporte" },
  } as never);
}

describe("relatório e Nino usam a mesma competência", () => {
  const transactions = [cardPurchaseJulyCompetenceAugust, cashAugust];

  it("compra de cartão de julho com fatura em agosto entra em agosto no relatório", () => {
    const transporte = report(transactions).payload.categories.find((c) => c.category === "Transporte");
    expect(transporte?.total).toBe(1400);
  });

  it("o motor de metas devolve exatamente o mesmo total da categoria", () => {
    const reportTotal = report(transactions).payload.categories
      .find((c) => c.category === "Transporte")?.total ?? 0;

    const assessment = computeGoalPerformanceAssessment({
      txs: transactions,
      categoryNameById: { [CAT]: "Transporte" },
      goals: [GOAL],
      today: REFERENCE,
      current: { from: "2026-08-01", to: "2026-08-31" },
      comparison: { from: "2026-07-01", to: "2026-07-31" },
    } as never) as unknown as { categories: Array<{ category_id: string; goal?: { actual?: number } }> };

    const engineTotal = Number(
      assessment.categories.find((c) => c.category_id === CAT)?.goal?.actual ?? 0,
    );
    expect(engineTotal).toBe(reportTotal);
  });

  it("estorno abate a categoria da mesma forma nas duas leituras", () => {
    const withRefund = [
      ...transactions,
      tx({
        amount: 100,
        occurred_at: "2026-08-12",
        competence_date: null,
        type: "income",
        movement_kind: "refund",
        refund_of_transaction_id: cashAugust.id,
      }),
    ];
    const reportTotal = report(withRefund).payload.categories
      .find((c) => c.category === "Transporte")?.total ?? 0;

    const assessment = computeGoalPerformanceAssessment({
      txs: withRefund,
      categoryNameById: { [CAT]: "Transporte" },
      goals: [GOAL],
      today: REFERENCE,
      current: { from: "2026-08-01", to: "2026-08-31" },
      comparison: { from: "2026-07-01", to: "2026-07-31" },
    } as never) as unknown as { categories: Array<{ category_id: string; goal?: { actual?: number } }> };
    const engineTotal = Number(
      assessment.categories.find((c) => c.category_id === CAT)?.goal?.actual ?? 0,
    );

    expect(reportTotal).toBe(1300);
    expect(engineTotal).toBe(reportTotal);
  });

});


describe("agregações do app por competência", () => {
  const rows: ReportTxn[] = [
    {
      type: "expense", status: "confirmed", amount: 1000, occurred_at: "2026-07-28",
      competence_date: "2026-08-05", payment_method: "credit_card", credit_card_id: "card-1",
      category_name: "Transporte",
    },
    {
      type: "expense", status: "confirmed", amount: 400, occurred_at: "2026-08-10",
      category_name: "Transporte",
    },
  ];

  it("mês do agrupamento é o da competência", () => {
    const buckets = groupByMonth(rows);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ ym: "2026-08", expense: 1400 });
  });

  it("filtro de período usa competência, não a data da compra", () => {
    const august = filterPeriod(rows, "2026-08-01", "2026-08-31");
    expect(august).toHaveLength(2);
    expect(byCategory(august)[0]).toMatchObject({ category: "Transporte", total: 1400 });
  });
});

describe("guarda de competência", () => {
  it("nenhuma agregação mensal carrega lançamentos sem competence_date", () => {
    expect(findMissingCompetenceSelects()).toEqual([]);
  });
});
