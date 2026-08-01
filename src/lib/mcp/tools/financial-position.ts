import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";
import { brl, errorResult, ok, requireUser } from "../shared";
import {
  computeCardExposure,
  totalCardDebtOf,
  totalFutureInstallmentsOf,
  type CardInstallmentRow,
  type CardStatementRow,
  type CardTxRow,
} from "../../engine/cardExposure";
import { currentMonthYM } from "../../engine/facts";

export default defineTool({
  name: "financial_position",
  title: "Posição financeira",
  description:
    "Mostra a posição atual do usuário autenticado: cartões de crédito ativos com fatura atual e dívida real, dívidas em aberto e metas em andamento.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!requireUser(ctx)) return errorResult("Não autenticado.");
    const supabase = supabaseForUser(ctx);

    const [cardsRes, debtsRes, goalsRes, statementsRes, installmentsRes, txsRes] = await Promise.all([
      supabase.from("credit_cards").select("id, name, brand, last_four, total_limit, due_day").eq("active", true),
      supabase.from("debts").select("id, name, creditor, outstanding_balance, installment_amount, status"),
      supabase.from("goals").select("id, name, target_amount, target_date, status"),
      supabase.from("credit_card_statements")
        .select("credit_card_id,competence_month,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status"),
      supabase.from("credit_card_installments")
        .select("credit_card_id,competence_month,amount,status,absorbed_by_statement_id"),
      supabase.from("transactions")
        .select("credit_card_id,competence_date,occurred_at,amount,type,status,settles_card_id")
        .not("credit_card_id", "is", null),
    ]);
    if (cardsRes.error) return errorResult(cardsRes.error.message);

    // FONTE ÚNICA de exposição de cartão (finance_contract.v1 / card_exposure.v1).
    const exposures = computeCardExposure({
      cardIds: (cardsRes.data ?? []).map((c) => c.id),
      statements: (statementsRes.data ?? []) as CardStatementRow[],
      installments: (installmentsRes.data ?? []) as CardInstallmentRow[],
      txs: (txsRes.data ?? []) as CardTxRow[],
      currentYM: currentMonthYM(),
    });
    const cardDebtToday = totalCardDebtOf(exposures);
    const cardFutureInstallments = totalFutureInstallmentsOf(exposures);

    const cards = (cardsRes.data ?? []).map((c) => {
      const e = exposures[c.id];
      return {
        id: c.id,
        name: c.name,
        brand: c.brand,
        last_four: c.last_four,
        limit: Number(c.total_limit ?? 0),
        due_day: c.due_day,
        current_statement: e?.currentStatement.amount ?? 0,
        current_statement_source: e?.currentStatement.source ?? "none",
        next_statement: e?.nextStatement.amount ?? 0,
        future_installments: e?.futureInstallments ?? 0,
        debt_today: e?.totalCardDebt ?? 0,
      };
    });
    const debts = (debtsRes.data ?? []).filter((d) => d.status !== "settled");
    const goals = (goalsRes.data ?? []).filter((g) => g.status === "active");

    const lines = [
      cards.length ? "Cartões ativos:" : "Nenhum cartão ativo.",
      ...cards.map((c) =>
        `- ${c.name} ${c.last_four ? `••${c.last_four}` : ""} · limite ${brl(c.limit)} · fatura atual ${brl(c.current_statement)}` +
        `${c.current_statement_source === "estimated" ? " (estimada)" : " (oficial)"} · dívida hoje ${brl(c.debt_today)}`
      ),
      cards.length ? `Dívida do cartão hoje: ${brl(cardDebtToday)} · compromisso futuro de parcelas (não é dívida): ${brl(cardFutureInstallments)}` : "",
      "",
      debts.length ? "Dívidas em aberto:" : "Nenhuma dívida em aberto.",
      ...debts.map((d) => `- ${d.name}${d.creditor ? ` (${d.creditor})` : ""} · saldo ${brl(Number(d.outstanding_balance ?? 0))}`),
      "",
      goals.length ? "Metas ativas:" : "Nenhuma meta ativa.",
      ...goals.map((g) => `- ${g.name} · objetivo ${brl(Number(g.target_amount ?? 0))}${g.target_date ? ` até ${g.target_date}` : ""}`),
    ].filter(Boolean);

    return ok(lines.join("\n"), {
      cards,
      card_debt_today: cardDebtToday,
      card_future_installments: cardFutureInstallments,
      formula_version: "finance_contract.v1",
      debts: debts.map((d) => ({ id: d.id, name: d.name, outstanding_balance: Number(d.outstanding_balance ?? 0) })),
      goals: goals.map((g) => ({ id: g.id, name: g.name, target_amount: Number(g.target_amount ?? 0), target_date: g.target_date })),
    });
  },
});
