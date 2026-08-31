import { describe, expect, it } from "vitest";
import { evaluateCategoryGoal } from "@/lib/engine/metrics";
import { computeCategoryBreakdown } from "@/lib/engine/facts";
import { buildIntelligentReport } from "@/lib/reports/intelligent/engine";
import { REPORT_TEMPLATE_VERSION } from "@/lib/reports/intelligent/types";
import { isReportStale } from "@/lib/reports/intelligent/client";

/**
 * Convergência por categoria (`reporting_competence.v1`).
 *
 * Reproduz o caso real que gerou o incidente: em agosto a categoria tem gasto
 * em conta, compra de cartão feita em julho com competência de agosto e um
 * estorno. Tela da categoria (breakdown), meta por categoria e relatório
 * precisam devolver EXATAMENTE o mesmo total.
 */
const CATEGORY = "cat-transporte";
const categories = [{ id: CATEGORY, name: "Transporte", type: "expense" as const }];

const tx = (over: Record<string, unknown>) => ({
  id: String(over.id),
  user_id: "u1",
  account_id: "acc",
  category_id: CATEGORY,
  type: "expense",
  status: "confirmed",
  amount: 0,
  occurred_at: "2026-08-10",
  payment_method: "account",
  credit_card_id: null,
  competence_date: null,
  movement_kind: "transaction",
  origin: "manual",
  ...over,
}) as never;

const txs = [
  tx({ id: "t1", amount: 100, occurred_at: "2026-08-03" }),
  tx({ id: "t2", amount: 60, occurred_at: "2026-08-20" }),
  // Compra de cartão de julho cuja fatura fecha em agosto: é gasto de agosto.
  tx({ id: "t3", amount: 500, occurred_at: "2026-07-26", payment_method: "credit_card", credit_card_id: "card1", competence_date: "2026-08-01" }),
  // Compra de cartão com competência de setembro: NÃO é gasto de agosto.
  tx({ id: "t4", amount: 300, occurred_at: "2026-08-28", payment_method: "credit_card", credit_card_id: "card1", competence_date: "2026-09-01" }),
  // Estorno vinculado abate a categoria original.
  tx({ id: "t5", amount: 40, occurred_at: "2026-08-22", movement_kind: "refund", type: "income", refund_of_transaction_id: "t1" }),
];

const EXPECTED = 620; // 100 + 60 + 500 − 40

describe("uma única verdade por categoria em todas as telas", () => {
  it("breakdown do mês (home/categorias/MCP) soma pela competência da fatura", () => {
    const rows = computeCategoryBreakdown(txs, categories, "2026-08", "expense");
    expect(rows.find((r) => r.id === CATEGORY)?.amount).toBe(EXPECTED);
  });

  it("meta por categoria chega ao mesmo total", () => {
    const evaluation = evaluateCategoryGoal(
      {
        id: "g1", user_id: "u1", category_id: CATEGORY, status: "active",
        period_type: "custom", start_date: "2026-08-01", end_date: "2026-08-31",
        computed_limit: 1000, baseline_value: 0,
      } as never,
      txs,
      new Date("2026-08-31T12:00:00Z"),
      "Transporte",
    );
    expect(evaluation.actualSpend).toBe(EXPECTED);
  });

  it("relatório do período chega ao mesmo total por categoria", () => {
    const report = buildIntelligentReport({
      reportType: "custom",
      referenceDate: "2026-08-31",
      customPeriod: { start: "2026-08-01", end: "2026-08-31" },
      transactions: txs,
      categoryNames: { [CATEGORY]: "Transporte" },
    } as never);
    const cat = report.payload.categories.find((c) => c.category === "Transporte");
    expect(cat?.total).toBe(EXPECTED);
  });

  it("relatório gerado por motor anterior é sinalizado, não apresentado como atual", () => {
    expect(isReportStale({ template_version: "report_template.v3" })).toBe(true);
    expect(isReportStale({ template_version: REPORT_TEMPLATE_VERSION })).toBe(false);
    expect(isReportStale({ template_version: null })).toBe(true);
  });
});
