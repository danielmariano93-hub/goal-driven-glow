// Fatos locais usados por telemetria e testes da dica da Home.
// O texto exibido vem sempre da inteligência unificada do Nino (backend).
import type { InsightFacts } from "@/lib/insights/fallbacks";
import { computeMonthlyTotals, type TransactionRow } from "@/lib/engine/facts";

export function buildAssistantFacts(
  txs: TransactionRow[],
  goals: Array<{ name?: string | null }>,
  ym = new Date().toISOString().slice(0, 7),
): InsightFacts {
  const arr = txs ?? [];
  const totals = computeMonthlyTotals(arr, ym);
  let uncategorized: InsightFacts["uncategorized_tx"] = null;
  let bestAmt = 0;
  for (const t of arr) {
    if (!t.occurred_at?.startsWith(ym)) continue;
    if (t.status !== "confirmed") continue;
    if (t.type !== "expense") continue;
    if (t.category_id) continue;
    const mk = (t.movement_kind ?? "transaction").toString();
    if (mk !== "transaction") continue;
    const amt = Number(t.amount || 0);
    if (amt > bestAmt) {
      bestAmt = amt;
      uncategorized = { id: t.id, description: t.description ?? null, amount: amt, occurred_at: t.occurred_at };
    }
  }
  return {
    total_tx_ever: arr.length,
    month: ym,
    income_month: totals.income,
    expense_month: totals.expense,
    balance_month: totals.net,
    active_goals: (goals ?? []).length,
    goal_names: (goals ?? []).slice(0, 3).map((g) => g?.name ?? "").filter(Boolean) as string[],
    uncategorized_tx: uncategorized,
  };
}

/** Chave de assunto (usada por testes e telemetria de rotação). */
export function tipSubjectKey(p: { type: string; title: string }): string {
  return `${p.type}:${(p.title ?? "").trim().toLowerCase()}`;
}
