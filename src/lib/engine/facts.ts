import { formatPrivateBRL } from "@/lib/privacy";

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

export interface AccountBalanceSnapshotRow {
  account_id: string;
  balance_date: string;
  balance: number;
  status?: string;
}

export type PaymentMethod = "account" | "credit_card" | "cash" | "pix" | "other";

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
  payment_method?: PaymentMethod | string | null;
  credit_card_id?: string | null;
  competence_date?: string | null;
  /** Se preenchido, esta transação é um pagamento de fatura do cartão indicado. */
  settles_card_id?: string | null;
}

export interface CreditCardRow {
  id: string;
  name: string;
  total_limit: number;
  closing_day: number;
  due_day: number;
  active: boolean;
}

/**
 * Resolve the effective payment origin for a confirmed tx.
 * Legacy rows may have null payment_method; infer from credit_card_id.
 */
export function txOrigin(t: Pick<TransactionRow, "payment_method" | "credit_card_id">):
  "account" | "credit_card" {
  if (t.credit_card_id) return "credit_card";
  const pm = (t.payment_method ?? "").toString().toLowerCase();
  if (pm === "credit_card") return "credit_card";
  return "account";
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
  txs: TransactionRow[],
  snapshots: AccountBalanceSnapshotRow[] = []
): Record<string, number> {
  const map: Record<string, number> = {};
  const cutoff: Record<string, string> = {};
  for (const a of accounts) map[a.id] = Number(a.opening_balance || 0);
  for (const s of snapshots.filter((x) => !x.status || x.status === "confirmed").sort((a,b) => a.balance_date.localeCompare(b.balance_date))) {
    map[s.account_id] = Number(s.balance);
    cutoff[s.account_id] = s.balance_date;
  }
  for (const t of txs) {
    if (t.status !== "confirmed") continue;
    if (t.type === "transfer") continue;
    // Só afeta a conta se a origem for a própria conta (não cartão).
    if (txOrigin(t) !== "account") continue;
    if (!t.account_id) continue;
    if (cutoff[t.account_id] && t.occurred_at <= cutoff[t.account_id]) continue;
    const amt = Number(t.amount || 0);
    if (!map[t.account_id] && map[t.account_id] !== 0) map[t.account_id] = 0;
    if (t.type === "income") map[t.account_id] += amt;
    else if (t.type === "expense") map[t.account_id] -= amt;
  }
  // Transferências continuam movendo dinheiro entre contas (pares).
  const groups: Record<string, TransactionRow[]> = {};
  for (const t of txs) {
    if (t.type !== "transfer" || t.status !== "confirmed" || !t.transfer_group_id) continue;
    (groups[t.transfer_group_id] ||= []).push(t);
  }
  for (const legs of Object.values(groups)) {
    if (legs.length < 2) continue;
    const sorted = [...legs].sort((a, b) => a.id.localeCompare(b.id));
    const src = sorted[0];
    const dst = sorted[1];
    if (cutoff[src.account_id] && src.occurred_at <= cutoff[src.account_id]) continue;
    if (cutoff[dst.account_id] && dst.occurred_at <= cutoff[dst.account_id]) continue;
    const amt = Number(src.amount || 0);
    map[src.account_id] = (map[src.account_id] || 0) - amt;
    map[dst.account_id] = (map[dst.account_id] || 0) + amt;
  }
  for (const k of Object.keys(map)) map[k] = round2(map[k]);
  return map;
}

export function computeTotalCash(accounts: AccountRow[], txs: TransactionRow[], snapshots: AccountBalanceSnapshotRow[] = []): number {
  const bals = computeAccountBalances(accounts, txs, snapshots);
  return round2(Object.values(bals).reduce((a, b) => a + b, 0));
}

/** Fatura em aberto (estimativa v1): soma expenses confirmadas com credit_card_id.
 *  Pagamentos de fatura (transactions payment_method='account' quitando cartão)
 *  ainda não são modelados; considerar limitação e exibir como "estimativa". */
export function computeCreditCardOutstanding(txs: TransactionRow[], cardId?: string): number {
  let total = 0;
  for (const t of txs) {
    if (t.status !== "confirmed" || t.type !== "expense") continue;
    if (cardId) {
      if (t.credit_card_id === cardId) total += Number(t.amount || 0);
      if (t.settles_card_id === cardId) total -= Number(t.amount || 0);
    } else {
      if (txOrigin(t) === "credit_card") total += Number(t.amount || 0);
      if (t.settles_card_id) total -= Number(t.amount || 0);
    }
  }
  return round2(Math.max(0, total));
}

export function computeCreditCardOutstandingByCard(txs: TransactionRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const t of txs) {
    if (t.status !== "confirmed" || t.type !== "expense") continue;
    if (t.credit_card_id) map[t.credit_card_id] = (map[t.credit_card_id] || 0) + Number(t.amount || 0);
    if (t.settles_card_id) map[t.settles_card_id] = (map[t.settles_card_id] || 0) - Number(t.amount || 0);
  }
  for (const k of Object.keys(map)) map[k] = round2(Math.max(0, map[k]));
  return map;
}

/** Month = "YYYY-MM" */
export function isInMonth(dateStr: string, ym: string): boolean {
  return dateStr.startsWith(ym);
}

export function computeMonthlyIncomeExpense(
  txs: TransactionRow[],
  ym: string,
  filter?: { origin?: "account" | "credit_card" | "all" },
) {
  const origin = filter?.origin ?? "all";
  const inMonth = txs.filter((t) => isInMonth(t.occurred_at, ym) && t.status === "confirmed" && t.type !== "transfer");
  const scoped = origin === "all" ? inMonth : inMonth.filter((t) => txOrigin(t) === origin);
  const income = sumBy(scoped.filter((t) => t.type === "income"), (t) => Number(t.amount));
  const expense = sumBy(scoped.filter((t) => t.type === "expense"), (t) => Number(t.amount));
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
  debts: DebtRow[],
  snapshots: AccountBalanceSnapshotRow[] = []
) {
  const cash = computeTotalCash(accounts, txs, snapshots);
  const invested = sumBy(investments, (i) => Number(i.current_value));
  const cardsOwed = computeCreditCardOutstanding(txs);
  const otherDebts = sumBy(
    debts.filter((d) => d.status === "active"),
    (d) => Number(d.outstanding_balance)
  );
  const owed = round2(cardsOwed + otherDebts);
  const net = round2(cash + invested - owed);
  return { cash, invested, cardsOwed, otherDebts, owed, net };
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
  return formatPrivateBRL(n);
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
