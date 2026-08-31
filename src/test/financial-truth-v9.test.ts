import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIntelligentReport } from "@/lib/reports/intelligent/engine";
import { REPORT_TEMPLATE_VERSION } from "@/lib/reports/intelligent/types";
import type { TransactionRow } from "@/lib/engine/facts";

/**
 * `financial_truth.v9` — três verdades separadas.
 *
 * 1. FINANCEIRA/COMPETÊNCIA: cartão pertence ao mês do fechamento da fatura.
 * 2. COMPORTAMENTAL: ritmo diário usa dias corridos do período.
 * 3. CAIXA: dívida de cartão vem da fatura oficial quando ela existe.
 */

const CAT = "cat-transporte";

function tx(p: Partial<TransactionRow> & { amount: number; occurred_at: string }): TransactionRow {
  return {
    id: `${p.occurred_at}:${p.amount}:${p.type ?? "expense"}`,
    account_id: "acc-1",
    type: "expense",
    status: "confirmed",
    category_id: CAT,
    description: null,
    transfer_group_id: null,
    ...p,
  } as unknown as TransactionRow;
}

const PERIOD = { start: "2026-08-01", end: "2026-08-31" };
const REFERENCE = new Date(Date.UTC(2026, 7, 31, 12));

function report(transactions: TransactionRow[], extra: Record<string, unknown> = {}) {
  return buildIntelligentReport({
    reportType: "custom",
    referenceDate: REFERENCE,
    customPeriod: PERIOD,
    transactions,
    categoryNames: { [CAT]: "Transporte" },
    ...extra,
  } as never);
}

describe("template do relatório", () => {
  it("declara a versão v5 (lente de competência + estorno + média por dias corridos)", () => {
    expect(REPORT_TEMPLATE_VERSION).toBe("report_template.v5");
  });
});

describe("gasto médio por dia", () => {
  it("divide pelos dias corridos do período, não pelos dias com gasto", () => {
    const txs = [
      tx({ amount: 300, occurred_at: "2026-08-05" }),
      tx({ amount: 320, occurred_at: "2026-08-06" }),
    ];
    const totals = report(txs).payload.totals;
    expect(totals.daysWithExpense).toBe(2);
    // 620 ÷ 31 dias corridos de agosto
    expect(totals.dailyAvgExpense).toBe(20);
  });
});

describe("dívida de cartão no relatório", () => {
  const purchase = tx({
    amount: 1000,
    occurred_at: "2026-08-10",
    payment_method: "credit_card",
    credit_card_id: "card-1",
    competence_date: "2026-08-25",
  });

  it("sem fatura registrada, usa o cálculo por lançamentos", () => {
    expect(report([purchase]).payload.totals.cardOutstanding).toBeGreaterThan(0);
  });

  it("com fatura oficial paga, a dívida é a da fatura — não a soma das compras", () => {
    const totals = report([purchase], {
      creditCards: [{ id: "card-1", name: "Cartão", closing_day: 25, due_day: 30 }],
      cardStatements: [{
        id: "st-1",
        credit_card_id: "card-1",
        competence_month: "2026-08-01",
        due_date: "2026-08-30",
        stated_total: 1000,
        paid_amount: 1000,
        status: "paid",
        requires_manual_review: false,
      }],
      cardInstallments: [],
    }).payload.totals;
    expect(totals.cardOutstanding).toBe(0);
  });
});

describe("estorno na composição econômica", () => {
  it("estorno abate a mesma composição da despesa original", () => {
    const original = tx({ amount: 200, occurred_at: "2026-08-04" });
    const withRefund = report([
      original,
      tx({
        amount: 200,
        occurred_at: "2026-08-09",
        type: "income",
        movement_kind: "refund",
        refund_of_transaction_id: original.id,
      }),
    ]).payload.totals;
    expect(withRefund.essentialTotal + withRefund.flexibleTotal).toBe(0);
  });
});

describe("paged_select.v1 no MCP", () => {
  it("resumo do mês e posição financeira paginam toda leitura de histórico", () => {
    const bundle = readFileSync("supabase/functions/mcp/index.ts", "utf8");
    expect(bundle).toContain("fetchAllPagesMcp");
    expect(bundle).not.toContain('supabase.from("transactions").select(TX_COLUMNS),');
    const monthly = readFileSync("src/lib/mcp/tools/monthly-summary.ts", "utf8");
    expect(monthly).toContain("fetchAllPages");
  });
});

describe("competência do cartão no banco", () => {
  it("card_cycle_for usa o mês do fechamento como competência", () => {
    const migration = readFileSync(
      "supabase/migrations/20260831235435_f237ee47-452e-45c8-b221-77ea25f5f13b.sql",
      "utf8",
    );
    expect(migration).toContain("competence_month := date_trunc('month', closing_date)::date;");
    expect(migration).toContain("home_snapshot.v4");
  });
});
