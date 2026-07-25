import type { QueryClient } from "@tanstack/react-query";
import { qk } from "./queryKeys";

/**
 * Invalida todas as queries que dependem do estado financeiro do usuário.
 * Fonte única de verdade em `queryKeys.ts` — nunca duplicar chaves aqui.
 */
export function invalidateFinancialQueries(qc: QueryClient) {
  const keys: readonly (readonly string[])[] = [
    qk.transactions,
    qk.accounts,
    qk.accountBalanceSnapshots,
    qk.dashboard,
    qk.pulse,
    qk.assistantTip,
    qk.insights,
    qk.investments,
    qk.debts,
    qk.goals,
    qk.contributions,
    qk.creditCards,
    qk.recurring,
    qk.categorySpendingGoals,
    qk.financialSnapshot,
    qk.sharedGoals,
    qk.sharedExpenses,
  ];
  for (const key of keys) qc.invalidateQueries({ queryKey: key as unknown as readonly unknown[] });
}
