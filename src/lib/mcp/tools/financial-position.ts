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
import { currentMonthYM, todaySP } from "../../engine/facts";
import { fetchAllPages } from "../../db/pagedSelect";

const CARD_TX_PAGE_SIZE = 1_000;

export default defineTool({
  name: "financial_position",
  title: "Posição financeira",
  description:
    "Mostra a posição financeira reconciliada do usuário autenticado: cartões com obrigação atual (inclusive cartões inativos), parcelas futuras, dívidas fora do cartão e metas em andamento.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!requireUser(ctx)) return errorResult("Não autenticado.");
    const supabase = supabaseForUser(ctx);

    const [cardsRes, debtsRes, goalsRes, statementsRes, installmentsRes] = await Promise.all([
      supabase.from("credit_cards").select("id, name, brand, last_four, total_limit, closing_day, due_day, active"),
      supabase.from("debts").select("id, name, creditor, outstanding_balance, installment_amount, status"),
      supabase.from("goals").select("id, name, target_amount, target_date, status"),
      // `paged_select.v1`: fatura e parcela também passam de 1.000 linhas em
      // histórico longo — sem paginar, a obrigação apareceria menor do que é.
      fetchAllPages<CardStatementRow>(
        (from, to) => supabase.from("credit_card_statements")
          .select("credit_card_id,competence_month,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status")
          .order("competence_month", { ascending: true }).order("credit_card_id", { ascending: true })
          .range(from, to) as never,
        { source: "mcp_statements" },
      ).then((data) => ({ data, error: null as null | { message: string } }))
        .catch((e: unknown) => ({ data: [] as CardStatementRow[], error: { message: String((e as Error)?.message ?? e) } })),
      fetchAllPages<CardInstallmentRow>(
        (from, to) => supabase.from("credit_card_installments")
          .select("credit_card_id,competence_month,amount,status,absorbed_by_statement_id")
          .order("competence_month", { ascending: true }).order("id", { ascending: true })
          .range(from, to) as never,
        { source: "mcp_installments" },
      ).then((data) => ({ data, error: null as null | { message: string } }))
        .catch((e: unknown) => ({ data: [] as CardInstallmentRow[], error: { message: String((e as Error)?.message ?? e) } })),
    ]);

    const sourceResults = [
      ["cartões", cardsRes],
      ["dívidas", debtsRes],
      ["metas", goalsRes],
      ["faturas", statementsRes],
      ["parcelas", installmentsRes],
    ] as const;
    for (const [source, result] of sourceResults) {
      if (result.error) {
        return errorResult(`Não foi possível reconciliar ${source} agora. Tente novamente.`, "upstream_unavailable");
      }
    }

    // O limite padrão do PostgREST é 1.000 linhas. Paginar é obrigatório para
    // que usuários com histórico longo não recebam uma posição silenciosamente truncada.
    const txs: CardTxRow[] = [];
    for (let from = 0; ; from += CARD_TX_PAGE_SIZE) {
      const page = await supabase.from("transactions")
        .select("credit_card_id,competence_date,occurred_at,amount,type,status,settles_card_id")
        .not("credit_card_id", "is", null)
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + CARD_TX_PAGE_SIZE - 1);
      if (page.error) {
        return errorResult("Não foi possível reconciliar os lançamentos de cartão agora. Tente novamente.", "upstream_unavailable");
      }
      const rows = (page.data ?? []) as CardTxRow[];
      txs.push(...rows);
      if (rows.length < CARD_TX_PAGE_SIZE) break;
    }

    // Mesma fonte de verdade usada no app e nas Edge Functions.
    const exposures = computeCardExposure({
      cardIds: (cardsRes.data ?? []).map((c) => c.id),
      cards: (cardsRes.data ?? []).map((c) => ({
        id: c.id,
        closing_day: c.closing_day,
        due_day: c.due_day,
      })),
      statements: (statementsRes.data ?? []) as CardStatementRow[],
      installments: (installmentsRes.data ?? []) as CardInstallmentRow[],
      txs,
      currentYM: currentMonthYM(),
      todayISO: todaySP(),
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
        active: c.active,
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
      cards.length ? "Cartões com posição financeira:" : "Nenhuma obrigação de cartão encontrada.",
      ...cards.map((c) =>
        `- ${c.name} ${c.last_four ? `••${c.last_four}` : ""} · limite ${brl(c.limit)} · fatura atual ${brl(c.current_statement)}` +
        `${c.current_statement_source === "estimated" ? " (estimada)" : " (oficial)"} · dívida hoje ${brl(c.debt_today)}` +
        `${c.active ? "" : " · cartão inativo, obrigação preservada"}`
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
      formula_version: "financial_position.v2",
      debts: debts.map((d) => ({ id: d.id, name: d.name, outstanding_balance: Number(d.outstanding_balance ?? 0) })),
      goals: goals.map((g) => ({ id: g.id, name: g.name, target_amount: Number(g.target_amount ?? 0), target_date: g.target_date })),
    });
  },
});
