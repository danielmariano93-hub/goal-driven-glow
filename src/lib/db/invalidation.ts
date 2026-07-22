import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalida todas as queries que dependem do estado financeiro do usuário.
 * Use após criar/editar/excluir/importar lançamentos, transferências ou saldos
 * para que Home, Pulso, Dicas e Patrimônio reflitam imediatamente.
 */
export function invalidateFinancialQueries(qc: QueryClient) {
  const keys = [
    ["transactions"],
    ["accounts"],
    ["account_balance_snapshots"],
    ["dashboard"],
    ["pulse"],
    ["assistant-tip"],
    ["insights"],
    ["investments"],
    ["debts"],
    ["goals"],
    ["contributions"],
    ["credit-cards"],
    ["recurring"],
    ["category_spending_goals"],
    ["financial-snapshot"],
  ] as const;
  for (const key of keys) qc.invalidateQueries({ queryKey: key as unknown as readonly unknown[] });
}
