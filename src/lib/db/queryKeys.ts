// Central query keys — evita divergências (credit_cards vs credit-cards) e
// serve como fonte única de verdade para invalidateFinancialQueries.
export const qk = {
  transactions: ["transactions"] as const,
  accounts: ["accounts"] as const,
  accountBalanceSnapshots: ["account_balance_snapshots"] as const,
  dashboard: ["dashboard"] as const,
  pulse: ["pulse"] as const,
  assistantTip: ["assistant-tip"] as const,
  insights: ["insights"] as const,
  investments: ["investments"] as const,
  debts: ["debts"] as const,
  goals: ["goals"] as const,
  contributions: ["contributions"] as const,
  creditCards: ["credit_cards"] as const,
  recurring: ["recurring"] as const,
  categorySpendingGoals: ["category_spending_goals"] as const,
  financialSnapshot: ["financial-snapshot"] as const,
  sharedGoals: ["shared_goals"] as const,
  sharedExpenses: ["shared_expenses"] as const,
  notifications: ["notifications"] as const,
} as const;

export type QueryKeyName = keyof typeof qk;
