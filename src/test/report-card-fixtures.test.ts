// Fixtures obrigatórias de cartão no relatório (report_projection.v1)
// ==================================================================
// A) fatura oficial aberta            E) parcela absorvida por statement
// B) fatura paga                      F) parcela ligada a legacy_transaction_id
// C) fatura parcialmente paga         G) statement em needs_review / divergência
// D) parcela futura ainda não faturada
//
// Invariantes: nada contado duas vezes; fatura paga = obrigação zero; parcela
// absorvida não reaparece como futuro; ledger legado não duplica parcela.
import { describe, expect, it } from "vitest";
import { buildIntelligentReport } from "@/lib/reports/intelligent/engine";
import { computeCardExposure } from "@/lib/engine/cardExposure";
import type { CardInstallmentRow, CardStatementRow } from "@/lib/engine/cardExposure";
import type { TransactionRow } from "@/lib/engine/facts";

const CARD = "card-1";
const REFERENCE = new Date("2026-09-10T12:00:00Z");
const CURRENT_YM = "2026-09";

const cards = [{ id: CARD, name: "Cartão", closing_day: 25, due_day: 5, active: true }];

const tx = (over: Partial<TransactionRow>): TransactionRow => ({
  id: crypto.randomUUID(),
  account_id: null,
  type: "expense",
  status: "confirmed",
  amount: 100,
  occurred_at: "2026-09-05",
  competence_date: "2026-09-05",
  category_id: null,
  description: null,
  transfer_group_id: null,
  payment_method: "credit_card",
  credit_card_id: CARD,
  ...over,
} as unknown as TransactionRow);

const statement = (over: Partial<CardStatementRow>): CardStatementRow => ({
  id: crypto.randomUUID(),
  credit_card_id: CARD,
  competence_month: `${CURRENT_YM}-01`,
  due_date: "2026-10-05",
  stated_total: 1000,
  paid_amount: 0,
  outstanding_amount: 1000,
  reconciliation_difference: 0,
  status: "open",
  ...over,
});

const installment = (over: Partial<CardInstallmentRow>): CardInstallmentRow => ({
  id: crypto.randomUUID(),
  credit_card_id: CARD,
  competence_month: "2026-11-01",
  amount: 300,
  status: "pending",
  legacy_transaction_id: null,
  absorbed_by_statement_id: null,
  purchase_id: "purchase-1",
  installment_number: 1,
  ...over,
});

function exposure(args: { statements: CardStatementRow[]; installments: CardInstallmentRow[]; txs?: TransactionRow[] }) {
  return computeCardExposure({
    cardIds: [CARD],
    statements: args.statements,
    installments: args.installments,
    txs: (args.txs ?? []) as never[],
    currentYM: CURRENT_YM,
    cards,
    todayISO: "2026-09-10",
  })[CARD];
}

describe("cartão no relatório: fixtures A–G", () => {
  it("A) fatura oficial aberta é a obrigação da competência", () => {
    const e = exposure({ statements: [statement({})], installments: [] });
    expect(e.currentStatement.source).toBe("official");
    expect(e.currentStatement.amount).toBe(1000);
    expect(e.totalCardDebt).toBe(1000);
  });

  it("B) fatura paga resulta em obrigação zero", () => {
    const e = exposure({
      statements: [statement({ status: "paid", paid_amount: 1000, outstanding_amount: 0 })],
      installments: [],
    });
    expect(e.totalCardDebt).toBe(0);
  });

  it("C) fatura parcialmente paga cobra apenas o que resta", () => {
    const e = exposure({
      statements: [statement({ status: "partially_paid", paid_amount: 400, outstanding_amount: 600 })],
      installments: [],
    });
    expect(e.totalCardDebt).toBe(600);
  });

  it("D) parcela de competência futura entra como futuro, não como dívida de hoje", () => {
    const e = exposure({
      statements: [statement({})],
      installments: [installment({ competence_month: "2026-11-01", amount: 300 })],
    });
    expect(e.futureInstallments).toBe(300);
    expect(e.totalCardDebt).toBe(1000);
  });

  it("E) parcela absorvida por fatura não reaparece como futuro", () => {
    const paid = statement({ status: "paid", paid_amount: 1000, outstanding_amount: 0 });
    const e = exposure({
      statements: [paid],
      installments: [
        installment({ competence_month: "2026-11-01", amount: 300, absorbed_by_statement_id: String(paid.id) }),
      ],
    });
    expect(e.futureInstallments).toBe(0);
    expect(e.totalCardDebt).toBe(0);
  });

  it("F) parcela ligada ao ledger legado não duplica a fatura reconstruída", () => {
    const legacy = tx({ amount: 300, occurred_at: "2026-09-10", competence_date: "2026-09-10" });
    const absorbing = statement({ id: "stmt-absorbing" });
    const semAbsorcao = exposure({
      statements: [],
      installments: [installment({ competence_month: `${CURRENT_YM}-01`, amount: 300, legacy_transaction_id: String(legacy.id) })],
      txs: [legacy],
    });
    const comAbsorcao = exposure({
      statements: [absorbing],
      installments: [
        installment({
          competence_month: `${CURRENT_YM}-01`,
          amount: 300,
          legacy_transaction_id: String(legacy.id),
          absorbed_by_statement_id: "stmt-absorbing",
        }),
      ],
      txs: [legacy],
    });
    // Reconstrução sem documento conta a parcela UMA vez (não 600).
    expect(semAbsorcao.currentStatement.amount).toBe(300);
    // Com fatura oficial, o lançamento legado é excluído da reconstrução.
    expect(comAbsorcao.currentStatement.source).toBe("official");
    expect(comAbsorcao.totalCardDebt).toBe(1000);
    expect(comAbsorcao.excludedAbsorbed).toBeGreaterThan(0);
  });

  it("G) divergência de conciliação marca a fatura para revisão", () => {
    const e = exposure({
      statements: [statement({ status: "needs_review", reconciliation_difference: 12.5 })],
      installments: [],
    });
    expect(e.needsReview).toBe(true);
    const semDivergencia = exposure({ statements: [statement({})], installments: [] });
    expect(semDivergencia.needsReview).toBe(false);
  });

  it("relatório expõe a mesma dívida de cartão do motor canônico", () => {
    const statements = [statement({ status: "partially_paid", paid_amount: 400, outstanding_amount: 600 })];
    const installments = [installment({ competence_month: "2026-11-01", amount: 300 })];
    const transactions = [tx({ amount: 600, occurred_at: "2026-09-03", competence_date: "2026-09-03" })];
    const report = buildIntelligentReport({
      reportType: "monthly_partial",
      referenceDate: REFERENCE,
      transactions,
      creditCards: cards,
      cardStatements: statements as unknown as Array<Record<string, unknown>>,
      cardInstallments: installments as unknown as Array<Record<string, unknown>>,
    });
    const canonical = exposure({ statements, installments, txs: transactions });
    expect(report.payload.totals.cardOutstanding).toBe(canonical.totalCardDebt);
  });

  it("fatura paga zera a dívida de cartão exibida no relatório", () => {
    const statements = [statement({ status: "paid", paid_amount: 1000, outstanding_amount: 0 })];
    const report = buildIntelligentReport({
      reportType: "monthly_partial",
      referenceDate: REFERENCE,
      transactions: [tx({ amount: 1000, occurred_at: "2026-09-04", competence_date: "2026-09-04" })],
      creditCards: cards,
      cardStatements: statements as unknown as Array<Record<string, unknown>>,
      cardInstallments: [],
    });
    expect(report.payload.totals.cardOutstanding).toBe(0);
  });
});
