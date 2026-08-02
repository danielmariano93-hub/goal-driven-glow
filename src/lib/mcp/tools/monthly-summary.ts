import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { brl, currentMonth, errorResult, ok, requireUser } from "../shared";
import {
  computeCategoryBreakdown,
  computeMonthlyTotals,
  type CategoryRow,
  type TransactionRow,
} from "../../engine/facts";
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

    const [txRes, catRes] = await Promise.all([
      supabase.from("transactions").select(TX_COLUMNS).like("occurred_at", `${target}%`),
      supabase.from("categories").select("id, name, type"),
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
    ];

    return ok(lines.join("\n"), {
      month: target,
      income: totals.income,
      expense: totals.expense,
      balance: totals.net,
      top_categories: top.map((c) => ({ name: c.name, total: c.amount, share: c.share })),
      formula_version: FINANCE_CONTRACT_VERSION,
    });
  },
});
