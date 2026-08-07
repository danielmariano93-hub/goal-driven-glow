import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOVEMENT_SEMANTICS } from "@/lib/engine/bridges";
import { computeCardExposure } from "@/lib/engine/cardExposure";
import { computeFinancialSnapshot, type FinancialSnapshotInput } from "@/lib/engine/metrics";
import { transactionSchema } from "@/lib/validation/finance";

const emptySnapshotInput = (): FinancialSnapshotInput => ({
  accounts: [{ id: "account", name: "Conta", type: "checking", opening_balance: 1_000, active: true }],
  txs: [],
  recurring: [],
  snapshots: [],
  investments: [],
  debts: [],
  categoryGoals: [],
  period: { start: "2026-08-01", end: "2026-08-31" },
  today: new Date(2026, 7, 31, 12),
});

describe("Nino functional complete v8 — verdade financeira", () => {
  it("não aceita placeholder zerado como fatura oficial quando há parcela conhecida", () => {
    const exposure = computeCardExposure({
      cardIds: ["card"],
      currentYM: "2026-08",
      todayISO: "2026-08-31",
      statements: [{
        id: "draft", credit_card_id: "card", competence_month: "2026-08-01",
        stated_total: 0, paid_amount: 0, outstanding_amount: 0, status: "draft",
      }],
      installments: [{
        id: "installment", credit_card_id: "card", competence_month: "2026-08-01",
        amount: 300, status: "scheduled",
      }],
      txs: [],
    });

    expect(exposure.card.currentStatement).toMatchObject({
      amount: 300, source: "estimated", installmentsAmount: 300,
    });
    expect(exposure.card.totalCardDebt).toBe(300);
  });

  it("mantém a obrigação da competência depois do vencimento e concilia patrimônio", () => {
    const snapshot = computeFinancialSnapshot({
      ...emptySnapshotInput(),
      cardIds: ["card"],
      cards: [{ id: "card", name: "Cartão", closing_day: 20, due_day: 30 }],
      cardStatements: [{
        id: "draft", credit_card_id: "card", competence_month: "2026-08-01",
        stated_total: 0, paid_amount: 0, outstanding_amount: 0, status: "draft",
      }],
      cardInstallments: [{
        id: "installment", credit_card_id: "card", competence_month: "2026-08-01",
        amount: 300, status: "scheduled",
      }],
    });

    expect(snapshot.projection.composition.cardDueThisMonth).toBe(300);
    expect(snapshot.projection.composition.cardDueIsEstimated).toBe(true);
    expect(snapshot.cardDebtToday).toBe(300);
    expect(snapshot.netWorth.cardsOwed).toBe(300);
    expect(snapshot.netWorth.net).toBe(700);
  });

  it("gera reconciliação estável por conteúdo e muda quando um valor muda", () => {
    const first = computeFinancialSnapshot(emptySnapshotInput());
    const sameFacts = computeFinancialSnapshot({
      ...emptySnapshotInput(),
      accounts: [...emptySnapshotInput().accounts].reverse(),
    });
    const changed = computeFinancialSnapshot({
      ...emptySnapshotInput(),
      accounts: [{ ...emptySnapshotInput().accounts[0], opening_balance: 999 }],
    });

    expect(first.audit.reconciliationId).toBe(sameFacts.audit.reconciliationId);
    expect(changed.audit.reconciliationId).not.toBe(first.audit.reconciliationId);
  });

  it("trata resgate como transferência patrimonial e rendimento como acréscimo real", () => {
    expect(MOVEMENT_SEMANTICS.investment_redemption).toMatchObject({
      cashImpact: 1, investmentImpact: -1, performanceImpact: 0, netWorthImpact: 0,
    });
    expect(MOVEMENT_SEMANTICS.investment_yield).toMatchObject({
      cashImpact: 1, investmentImpact: 0, performanceImpact: 0, netWorthImpact: 1,
    });
    const redemption = computeFinancialSnapshot({
      ...emptySnapshotInput(),
      today: new Date(2026, 7, 7, 12),
      investments: [{ id: "investment", name: "CDB", invested_amount: 400, current_value: 400, goal_id: null }],
      txs: [{
        id: "redemption", account_id: "account", category_id: null, type: "income", status: "confirmed",
        amount: 100, occurred_at: "2026-08-07", description: "Resgate CDB", transfer_group_id: null,
        payment_method: "account", movement_kind: "investment_redemption", investment_id: "investment",
      }],
      investmentMovements: [{ type: "redemption", amount: 100, occurred_at: "2026-08-07" }],
    });
    expect(redemption.availableToday).toBe(1_100);
    expect(redemption.monthlyTotals.income).toBe(0);
    expect(redemption.netWorth.net).toBe(1_500);
    expect(redemption.netWorthBridge.netWorthChange).toBe(0);

    const snapshot = computeFinancialSnapshot({
      ...emptySnapshotInput(),
      today: new Date(2026, 7, 7, 12),
      txs: [{
        id: "yield", account_id: "account", category_id: null, type: "income", status: "confirmed",
        amount: 100, occurred_at: "2026-08-07", description: "Rendimento", transfer_group_id: null,
        payment_method: "account", movement_kind: "investment_yield",
      }],
    });
    expect(snapshot.availableToday).toBe(1_100);
    expect(snapshot.monthlyTotals.income).toBe(0);
    expect(snapshot.netWorthBridge.netWorthChange).toBe(100);
    expect(snapshot.netWorthBridge.valuationAdjustments).toBe(0);
  });

  it("obriga o ativo explícito e a direção contábil ao registrar resgate", () => {
    const payload = {
      payment_method: "account" as const,
      account_id: "11111111-1111-4111-8111-111111111111",
      movement_kind: "investment_redemption" as const,
      type: "income" as const,
      amount: 100,
      occurred_at: "2026-08-07",
      installments_total: 1,
      installment_number: 1,
    };
    expect(transactionSchema.safeParse(payload).success).toBe(false);
    expect(transactionSchema.safeParse({
      ...payload, investment_id: "22222222-2222-4222-8222-222222222222",
    }).success).toBe(true);
    expect(transactionSchema.safeParse({
      ...payload, type: "expense", investment_id: "22222222-2222-4222-8222-222222222222",
    }).success).toBe(false);
  });
});

describe("Nino functional complete v8 — contratos de implantação", () => {
  it("migração é global, idempotente e protege propriedade do investimento", () => {
    const migration = readFileSync("supabase/migrations/20260807233000_nino_financial_truth_v8.sql", "utf8");
    expect(migration).toContain("investment_not_owned");
    expect(migration).toContain("principal_amount");
    expect(migration).toContain("NOT EXISTS");
    expect(migration).toContain("v_principal * v_row.amount / v_current");
    expect(migration).toContain("BEFORE DELETE OR UPDATE OF movement_kind");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF movement_kind");
    expect(migration).toContain("TG_WHEN = 'BEFORE'");
    expect(migration).not.toContain("@gmail.com");
    expect(migration).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("snapshot do agente pagina a fonte e falha explicitamente se uma consulta falhar", () => {
    const metrics = readFileSync("supabase/functions/_shared/engine/metrics.ts", "utf8");
    expect(metrics).toContain(".range(from, from + pageSize - 1)");
    expect(metrics).toContain("snapshot_source_transactions");
    expect(metrics).toContain('["card_statements", statementsRes]');
    expect(metrics).toContain("snapshot_source_${source}");
    expect(metrics).toMatch(/from\("credit_cards"\)[\s\S]{0,180}eq\("user_id", user_id\),/);
    expect(metrics).not.toMatch(/from\("credit_cards"\)[\s\S]{0,220}eq\("active", true\)/);
  });

  it("simulador exige data e usa o snapshot canônico v4", () => {
    const tools = readFileSync("supabase/functions/_shared/agent/tools.ts", "utf8");
    expect(tools).toContain('error: "missing_planned_date"');
    expect(tools).toContain('formula_version: "agent_spending_simulation.snapshot.v4"');
    expect(tools).toContain('required: ["amount", "planned_date"]');
  });
});
