// Central query keys — evita divergências (credit_cards vs credit-cards) e
// serve como fonte única de verdade para invalidateFinancialQueries.
export const qk = {
  transactions: ["transactions"] as const,
  accounts: ["accounts"] as const,
  accountBalanceSnapshots: ["account_balance_snapshots"] as const,
  dashboard: ["dashboard"] as const,
  home: ["home"] as const,
  pulse: ["pulse"] as const,
  assistantTip: ["assistant-tip"] as const,
  insights: ["insights"] as const,
  investments: ["investments"] as const,
  investmentMovements: ["investment_movements"] as const,
  debts: ["debts"] as const,
  debtPayments: ["debt_payments"] as const,
  goals: ["goals"] as const,
  contributions: ["contributions"] as const,
  categories: ["categories"] as const,
  creditCards: ["credit_cards"] as const,
  creditCardStatements: ["credit_card_statements"] as const,
  creditCardInstallments: ["credit_card_installments"] as const,
  creditCardPayments: ["credit_card_payments"] as const,
  statementDetail: ["statement-detail"] as const,
  recurring: ["recurring"] as const,
  recurringRules: ["recurring_rules"] as const,
  recurringOccurrences: ["recurring_occurrences"] as const,
  categorySpendingGoals: ["category_spending_goals"] as const,
  financialSnapshot: ["financial-snapshot"] as const,
  financialSettings: ["user_financial_settings"] as const,
  sharedGoals: ["shared_goals"] as const,
  sharedExpenses: ["shared_expenses"] as const,
  documentImports: ["document_imports"] as const,
  assessorDocuments: ["assessor_documents"] as const,
  notifications: ["notifications"] as const,
  advisorPerformance: ["advisor-performance"] as const,
  // Leitura derivada servida (`perf_derived.v1`).
  ledgerVersion: ["ledger-version"] as const,
  homeSnapshot: ["home-snapshot"] as const,
  performanceDetail: ["performance-detail"] as const,
} as const;

export type QueryKeyName = keyof typeof qk;

/** Chaves derivadas: dependem de qualquer verdade financeira. */
const DERIVED_KEYS: readonly (readonly string[])[] = [
  qk.dashboard, qk.home, qk.pulse, qk.assistantTip, qk.insights,
  qk.financialSnapshot, qk.advisorPerformance,
  // A versão do ledger é a chave-mestra das leituras derivadas: invalidá-la
  // derruba snapshot da Home e acompanhamento sem varredura manual.
  qk.ledgerVersion, qk.homeSnapshot, qk.performanceDetail,
];

/**
 * Escopos de invalidação (`invalidation_scope.v1`). Uma escrita de lançamento
 * não precisa recarregar metas conjuntas, documentos e recorrências: cada
 * escopo lista apenas as chaves que dependem daquele domínio, mais os
 * derivados (Home, pulso, snapshot, acompanhamento).
 */
export const INVALIDATION_SCOPES = {
  transactions: [
    qk.transactions, qk.accounts, qk.accountBalanceSnapshots,
    qk.categorySpendingGoals, qk.categories, ...DERIVED_KEYS,
  ],
  cards: [
    qk.transactions, qk.creditCards, qk.creditCardStatements,
    qk.creditCardInstallments, qk.creditCardPayments, qk.statementDetail,
    qk.accounts, ...DERIVED_KEYS,
  ],
  goals: [
    qk.goals, qk.contributions, qk.categorySpendingGoals, qk.sharedGoals,
    ...DERIVED_KEYS,
  ],
  debts: [qk.debts, qk.debtPayments, qk.transactions, ...DERIVED_KEYS],
  investments: [qk.investments, qk.investmentMovements, qk.accounts, ...DERIVED_KEYS],
} as const;

export type InvalidationScope = keyof typeof INVALIDATION_SCOPES | "all";

/** Chaves que TODA mutação financeira precisa invalidar (fonte única). */
export const FINANCIAL_QUERY_KEYS: readonly (readonly string[])[] = [

  qk.transactions,
  qk.accounts,
  qk.accountBalanceSnapshots,
  qk.dashboard,
  qk.home,
  qk.pulse,
  qk.assistantTip,
  qk.insights,
  qk.investments,
  qk.investmentMovements,
  qk.debts,
  qk.debtPayments,
  qk.goals,
  qk.contributions,
  qk.categories,
  qk.creditCards,
  qk.creditCardStatements,
  qk.creditCardInstallments,
  qk.creditCardPayments,
  qk.statementDetail,
  qk.recurring,
  qk.recurringRules,
  qk.recurringOccurrences,
  qk.categorySpendingGoals,
  qk.financialSnapshot,
  qk.financialSettings,
  qk.sharedGoals,
  qk.sharedExpenses,
  qk.documentImports,
  qk.assessorDocuments,
  qk.advisorPerformance,
  qk.ledgerVersion,
  qk.homeSnapshot,
  qk.performanceDetail,
];
