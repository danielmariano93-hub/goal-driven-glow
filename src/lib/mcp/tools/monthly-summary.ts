import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { brl, currentMonth, errorResult, ok, requireUser } from "../shared";
import {
  computeCategoryBreakdown,
  computeMonthlyTotals,
  type CategoryRow,
  type TransactionRow,
  type AccountRow,
  type AccountBalanceSnapshotRow,
} from "../../engine/facts";
import { computeCashBridge, computePeriodPerformance, explainBalanceChange } from "../../engine/bridges";
import { FINANCE_CONTRACT_VERSION } from "../../engine/metrics";

/** Colunas exigidas pelo contrato `TransactionRow` do finance-core. */
const TX_COLUMNS =
  "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,competence_date,settles_card_id,movement_kind";

export default defineTool({
  name: "monthly_summary",
  title: "Resumo do mês",
  description:
    "Resume o mês do usuário autenticado: total de receitas, total de despesas, saldo do período e as maiores categorias de gasto (regra comportamental única do Meu Nino).",
  inputSchema: {
    month: z.string().optional().describe("Mês no formato YYYY-MM. Padrão: mês atual."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ month }, ctx) => {
    if (!requireUser(ctx)) return errorResult("Não autenticado.", "unauthorized");
    const supabase = supabaseForUser(ctx);
    const target = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth();

    // A ponte de caixa exige o histórico completo (saldo inicial é derivado).
    const [txRes, catRes, accRes, snapRes] = await Promise.all([
      supabase.from("transactions").select(TX_COLUMNS),
      supabase.from("categories").select("id, name, type"),
      supabase.from("accounts").select("id,name,type,opening_balance,active"),
      supabase.from("account_balance_snapshots").select("account_id,balance,snapshot_date,source"),
    ]);

    if (txRes.error) return errorResult(txRes.error.message, "internal");

    const txs = ((txRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((t) => ({
      id: String(t.id),
      account_id: String(t.account_id ?? ""),
      category_id: (t.category_id as string | null) ?? null,
      type: t.type as TransactionRow["type"],
      status: t.status as TransactionRow["status"],
      amount: Number(t.amount ?? 0),
      occurred_at: String(t.occurred_at ?? ""),
      description: (t.description as string | null) ?? null,
      transfer_group_id: (t.transfer_group_id as string | null) ?? null,
      payment_method: (t.payment_method as string | null) ?? null,
      credit_card_id: (t.credit_card_id as string | null) ?? null,
      competence_date: (t.competence_date as string | null) ?? null,
      settles_card_id: (t.settles_card_id as string | null) ?? null,
      movement_kind: (t.movement_kind as string | null) ?? "transaction",
    })) as TransactionRow[];

    const categories = ((catRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ""),
      type: (c.type as "income" | "expense") ?? "expense",
    })) as CategoryRow[];

    const accounts = ((accRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id), name: String(a.name ?? ""), type: String(a.type ?? "checking"),
      opening_balance: Number(a.opening_balance ?? 0), active: Boolean(a.active ?? true),
    })) as unknown as AccountRow[];
    const snapshots = ((snapRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((s2) => ({
      account_id: String(s2.account_id ?? ""), balance: Number(s2.balance ?? 0),
      snapshot_date: String(s2.snapshot_date ?? ""), source: (s2.source as string | null) ?? null,
    })) as unknown as AccountBalanceSnapshotRow[];

    const lastDay = new Date(Date.UTC(Number(target.slice(0, 4)), Number(target.slice(5, 7)), 0))
      .getUTCDate();
    const period = { start: `${target}-01`, end: `${target}-${String(lastDay).padStart(2, "0")}` };
    const bridge = computeCashBridge({ accounts, txs, snapshots, period });
    const performance = computePeriodPerformance(txs, period);
    const explanation = explainBalanceChange(bridge, performance);

    const totals = computeMonthlyTotals(txs, target);
    const breakdown = computeCategoryBreakdown(txs, categories, target, "expense");
    const top = breakdown.slice(0, 5);

    const lines = [
      `Resumo de ${target}`,
      `Receitas: ${brl(totals.income)}`,
      `Despesas: ${brl(totals.expense)}`,
      `Saldo do período: ${brl(totals.net)}`,
      top.length ? "\nMaiores gastos por categoria:" : "\nNenhuma despesa registrada no período.",
      ...top.map((c) => `- ${c.name}: ${brl(c.amount)}`),
      "",
      "Como o saldo se formou (ponte de caixa):",
      `Saldo inicial: ${brl(bridge.openingCash)} → Saldo final: ${brl(bridge.confirmedClosingCash)}`,
      explanation.headline,
      ...explanation.lines.map((l) => `- ${l}`),
      Math.abs(bridge.reconciliationDifference) > 0.01
        ? `Atenção: reconciliação pendente de ${brl(bridge.reconciliationDifference)} — não afirme o saldo como exato.`
        : "Ponte reconciliada (diferença ≤ R$ 0,01).",
    ];

    return ok(lines.join("\n"), {
      month: target,
      income: totals.income,
      expense: totals.expense,
      balance: totals.net,
      top_categories: top.map((c) => ({ name: c.name, total: c.amount, share: c.share })),
      cash_bridge: {
        opening_cash: bridge.openingCash,
        closing_cash: bridge.confirmedClosingCash,
        operational_income: bridge.operationalIncome,
        operational_account_expense: bridge.operationalAccountExpense,
        investment_redemptions: bridge.investmentRedemptions,
        investment_applications: bridge.investmentApplications,
        card_payments: bridge.cardPayments,
        loan_proceeds: bridge.loanProceeds,
        debt_principal_payments: bridge.debtPrincipalPayments,
        external_transfers_in: bridge.externalTransfersIn,
        external_transfers_out: bridge.externalTransfersOut,
        refunds_and_reimbursements: bridge.refundsAndReimbursements,
        adjustments: bridge.adjustments,
        reconciliation_difference: bridge.reconciliationDifference,
        confidence: bridge.confidence,
      },
      period_performance: {
        operational_income: performance.operationalIncome,
        operational_expense: performance.operationalExpense,
        operational_result: performance.operationalResult,
        used_accumulated_resources: performance.usedAccumulatedResources,
      },
      balance_explanation: { headline: explanation.headline, lines: explanation.lines },
      formula_version: FINANCE_CONTRACT_VERSION,
    });
  },
});
