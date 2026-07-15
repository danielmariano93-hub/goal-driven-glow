// Pure factual engine — no arbitrary scores, no linear projections.
// All money in numbers with 2-decimal semantics; caller should format for display.

export type Money = number;

export interface AccountRow {
  id: string;
  name: string;
  type: string;
  opening_balance: number;
  active: boolean;
}

export interface TransactionRow {
  id: string;
  account_id: string;
  category_id: string | null;
  type: "income" | "expense" | "transfer";
  status: "confirmed" | "planned";
  amount: number;
  occurred_at: string; // YYYY-MM-DD
  description: string | null;
  transfer_group_id: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  type: "income" | "expense";
}

export interface GoalRow {
  id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
  status: string;
}

export interface GoalContributionRow {
  goal_id: string;
  amount: number;
  occurred_at: string;
}

export interface InvestmentRow {
  id: string;
  name: string;
  invested_amount: number;
  current_value: number;
  goal_id: string | null;
}

export interface DebtRow {
  id: string;
  name: string;
  outstanding_balance: number;
  original_amount: number;
  installment_amount?: number | null;
  status: string;
}

export interface RecurringRow {
  id: string;
  name: string;
  type: "income" | "expense";
  amount: number;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  next_due_date: string;
  active: boolean;
}

/** Round to 2 decimals to avoid float drift */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Sum an array's numeric field (safely) */
const sumBy = <T>(arr: T[], get: (x: T) => number) => round2(arr.reduce((a, b) => a + (get(b) || 0), 0));

/**
 * Balance per account = opening_balance + confirmed(income) - confirmed(expense) + transfer(in) - transfer(out)
 * Transfers move money between accounts and NEVER count as income/expense.
 */
export function computeAccountBalances(
  accounts: AccountRow[],
  txs: TransactionRow[]
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const a of accounts) map[a.id] = Number(a.opening_balance || 0);
  for (const t of txs) {
    if (t.status !== "confirmed") continue;
    const amt = Number(t.amount || 0);
    if (!map[t.account_id] && map[t.account_id] !== 0) map[t.account_id] = 0;
    if (t.type === "income") map[t.account_id] += amt;
    else if (t.type === "expense") map[t.account_id] -= amt;
    else if (t.type === "transfer") {
      // With paired legs, treat as +/- on each account depending on which leg via description convention?
      // We rely on the two-legs pattern where each row represents one leg's account.
      // Convention: first leg (source) debits, second leg (destination) credits.
      // We can't distinguish here, so use created order via transfer_group; caller uses pair.
    }
  }
  // Apply transfers by pair: pair legs by transfer_group_id
  const groups: Record<string, TransactionRow[]> = {};
  for (const t of txs) {
    if (t.type !== "transfer" || t.status !== "confirmed" || !t.transfer_group_id) continue;
    (groups[t.transfer_group_id] ||= []).push(t);
  }
  for (const legs of Object.values(groups)) {
    if (legs.length < 2) continue;
    // sort by created id string to be deterministic; assume first row = source (debit), second = destination (credit)
    const sorted = [...legs].sort((a, b) => a.id.localeCompare(b.id));
    const src = sorted[0];
    const dst = sorted[1];
    const amt = Number(src.amount || 0);
    map[src.account_id] = (map[src.account_id] || 0) - amt;
    map[dst.account_id] = (map[dst.account_id] || 0) + amt;
  }
  for (const k of Object.keys(map)) map[k] = round2(map[k]);
  return map;
}

export function computeTotalCash(accounts: AccountRow[], txs: TransactionRow[]): number {
  const bals = computeAccountBalances(accounts, txs);
  return round2(Object.values(bals).reduce((a, b) => a + b, 0));
}

/** Month = "YYYY-MM" in local (America/Sao_Paulo) — occurred_at is already a date string, no TZ conversion needed */
export function isInMonth(dateStr: string, ym: string): boolean {
  return dateStr.startsWith(ym);
}

export function computeMonthlyIncomeExpense(txs: TransactionRow[], ym: string) {
  const inMonth = txs.filter((t) => isInMonth(t.occurred_at, ym) && t.status === "confirmed");
  const income = sumBy(inMonth.filter((t) => t.type === "income"), (t) => Number(t.amount));
  const expense = sumBy(inMonth.filter((t) => t.type === "expense"), (t) => Number(t.amount));
  return { income, expense, net: round2(income - expense) };
}

export function computeCategoryBreakdown(
  txs: TransactionRow[],
  categories: CategoryRow[],
  ym: string,
  type: "income" | "expense" = "expense"
) {
  const byCat: Record<string, number> = {};
  for (const t of txs) {
    if (t.type !== type || t.status !== "confirmed" || !isInMonth(t.occurred_at, ym)) continue;
    const key = t.category_id ?? "__none__";
    byCat[key] = (byCat[key] || 0) + Number(t.amount || 0);
  }
  const catName = (id: string) =>
    id === "__none__" ? "Sem categoria" : categories.find((c) => c.id === id)?.name ?? "Categoria removida";
  const total = round2(Object.values(byCat).reduce((a, b) => a + b, 0));
  return Object.entries(byCat)
    .map(([id, v]) => ({ id, name: catName(id), amount: round2(v), share: total > 0 ? v / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function computeGoalProgress(goal: GoalRow, contributions: GoalContributionRow[]) {
  const relevant = contributions.filter((c) => c.goal_id === goal.id);
  const contributed = sumBy(relevant, (c) => Number(c.amount));
  const remaining = round2(Math.max(0, Number(goal.target_amount) - contributed));
  const pct = goal.target_amount > 0 ? Math.min(1, contributed / Number(goal.target_amount)) : 0;
  return { contributed, remaining, pct };
}

export function computeNetWorth(
  accounts: AccountRow[],
  txs: TransactionRow[],
  investments: InvestmentRow[],
  debts: DebtRow[]
) {
  const cash = computeTotalCash(accounts, txs);
  const invested = sumBy(investments, (i) => Number(i.current_value));
  const owed = sumBy(
    debts.filter((d) => d.status === "active"),
    (d) => Number(d.outstanding_balance)
  );
  const net = round2(cash + invested - owed);
  return { cash, invested, owed, net };
}

export function nextRecurringOccurrences(recurring: RecurringRow[], horizonDays: number, today = new Date()) {
  const result: { id: string; name: string; type: "income" | "expense"; amount: number; date: string }[] = [];
  const t0 = new Date(today);
  t0.setHours(0, 0, 0, 0);
  const t1 = new Date(t0);
  t1.setDate(t1.getDate() + horizonDays);
  for (const r of recurring) {
    if (!r.active) continue;
    const cursor = new Date(r.next_due_date + "T00:00:00");
    while (cursor <= t1) {
      if (cursor >= t0) {
        result.push({ id: r.id, name: r.name, type: r.type, amount: Number(r.amount), date: cursor.toISOString().slice(0, 10) });
      }
      if (r.frequency === "daily") cursor.setDate(cursor.getDate() + 1);
      else if (r.frequency === "weekly") cursor.setDate(cursor.getDate() + 7);
      else if (r.frequency === "monthly") cursor.setMonth(cursor.getMonth() + 1);
      else if (r.frequency === "yearly") cursor.setFullYear(cursor.getFullYear() + 1);
      else break;
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export function computeUpcomingCommitments(
  recurring: RecurringRow[],
  plannedTxs: TransactionRow[],
  horizonDays = 30
) {
  const next = nextRecurringOccurrences(recurring, horizonDays);
  const planned = plannedTxs
    .filter((t) => t.status === "planned" && t.type !== "transfer")
    .map((t) => ({ id: t.id, name: t.description || "Compromisso", type: t.type as "income" | "expense", amount: Number(t.amount), date: t.occurred_at }));
  const combined = [...next, ...planned].sort((a, b) => a.date.localeCompare(b.date));
  const totalExpense = sumBy(combined.filter((c) => c.type === "expense"), (c) => c.amount);
  const totalIncome = sumBy(combined.filter((c) => c.type === "income"), (c) => c.amount);
  return { items: combined, totalIncome, totalExpense };
}

export interface BeforeSpendingInput {
  amount: number;
  accountId?: string | null;
  accounts: AccountRow[];
  txs: TransactionRow[];
  recurring: RecurringRow[];
  debts: DebtRow[];
  goals: GoalRow[];
  contributions: GoalContributionRow[];
  horizonDays?: number;
}

export interface BeforeSpendingOutput {
  totalCash: number;
  accountBalance: number | null;
  upcomingExpense: number;
  upcomingIncome: number;
  availableAfter: number;
  goalsAtRisk: { id: string; name: string; remaining: number }[];
  assumptions: string[];
  missingData: string[];
}

export function computeBeforeSpending(input: BeforeSpendingInput): BeforeSpendingOutput {
  const { amount, accountId, accounts, txs, recurring, debts, goals, contributions } = input;
  const horizonDays = input.horizonDays ?? 30;
  const balances = computeAccountBalances(accounts, txs);
  const totalCash = round2(Object.values(balances).reduce((a, b) => a + b, 0));
  const accountBalance = accountId ? balances[accountId] ?? 0 : null;
  const upcoming = computeUpcomingCommitments(recurring, txs, horizonDays);
  const activeDebts = sumBy(
    debts.filter((d) => d.status === "active"),
    (d) => Number(d.outstanding_balance)
  );
  const availableAfter = round2(totalCash - amount - upcoming.totalExpense + upcoming.totalIncome);

  const goalsAtRisk: { id: string; name: string; remaining: number }[] = [];
  for (const g of goals.filter((x) => x.status === "active")) {
    const { remaining } = computeGoalProgress(g, contributions);
    if (remaining > 0 && availableAfter < remaining * 0.1) {
      goalsAtRisk.push({ id: g.id, name: g.name, remaining });
    }
  }

  const assumptions: string[] = [
    `Saldo total considera todas as contas ativas (${accounts.filter((a) => a.active).length}).`,
    `Compromissos considerados no horizonte de ${horizonDays} dias.`,
    "Transferências entre contas não afetam o saldo total.",
  ];
  const missingData: string[] = [];
  if (accounts.length === 0) missingData.push("Nenhuma conta cadastrada — o cálculo usa saldo zero.");
  if (recurring.length === 0) missingData.push("Nenhuma recorrência cadastrada — compromissos futuros podem estar subestimados.");
  if (activeDebts > 0 && debts.every((d) => !d.installment_amount)) {
    missingData.push("Dívidas ativas sem parcela informada — impacto mensal não estimado.");
  }

  return {
    totalCash,
    accountBalance,
    upcomingExpense: upcoming.totalExpense,
    upcomingIncome: upcoming.totalIncome,
    availableAfter,
    goalsAtRisk,
    assumptions,
    missingData,
  };
}

/** Format helpers used across UI */
export function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
}

export function currentMonthYM(now = new Date()): string {
  // Use local time (browser typically America/Sao_Paulo for target users)
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
