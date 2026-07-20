// Server-side (Deno) copy of the factual engine used by the agent.
// Keep in sync with src/lib/engine/facts.ts. Pure functions only.

export type Money = number;

export interface AccountRow {
  id: string; name: string; type: string;
  opening_balance: number; active: boolean;
}
export interface TransactionRow {
  id: string; account_id: string; category_id: string | null;
  type: "income" | "expense" | "transfer";
  status: "confirmed" | "planned";
  amount: number; occurred_at: string;
  description: string | null; transfer_group_id: string | null;
  payment_method?: string | null;
  credit_card_id?: string | null;
  settles_card_id?: string | null;
  movement_kind?: string | null;
}

export function txOrigin(t: Pick<TransactionRow, "payment_method" | "credit_card_id">):
  "account" | "credit_card" {
  if (t.credit_card_id) return "credit_card";
  const pm = (t.payment_method ?? "").toString().toLowerCase();
  if (pm === "credit_card") return "credit_card";
  return "account";
}
export interface RecurringRow {
  id: string; name: string; type: "income" | "expense";
  amount: number;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  next_due_date: string; active: boolean;
}
export interface DebtRow {
  id: string; name: string;
  outstanding_balance: number; original_amount: number;
  installment_amount?: number | null; status: string;
}
export interface GoalRow {
  id: string; name: string;
  target_amount: number; target_date: string | null; status: string;
}
export interface GoalContributionRow {
  goal_id: string; amount: number; occurred_at: string;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeAccountBalances(accounts: AccountRow[], txs: TransactionRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const a of accounts) map[a.id] = Number(a.opening_balance || 0);
  for (const t of txs) {
    if (t.status !== "confirmed") continue;
    if (t.type === "transfer") continue;
    if (txOrigin(t) !== "account") continue;
    if (!t.account_id) continue;
    const amt = Number(t.amount || 0);
    map[t.account_id] = (map[t.account_id] || 0) + (t.type === "income" ? amt : -amt);
  }
  // Fatura em aberto por cartão (v1 estimativa) — expostas via helper abaixo.
  const groups: Record<string, TransactionRow[]> = {};
  for (const t of txs) {
    if (t.type !== "transfer" || t.status !== "confirmed" || !t.transfer_group_id) continue;
    (groups[t.transfer_group_id] ||= []).push(t);
  }
  for (const legs of Object.values(groups)) {
    if (legs.length < 2) continue;
    const sorted = [...legs].sort((a, b) => a.id.localeCompare(b.id));
    const [src, dst] = sorted;
    const amt = Number(src.amount || 0);
    map[src.account_id] = (map[src.account_id] || 0) - amt;
    map[dst.account_id] = (map[dst.account_id] || 0) + amt;
  }
  for (const k of Object.keys(map)) map[k] = round2(map[k]);
  return map;
}

export function computeCreditCardOutstanding(txs: TransactionRow[]): number {
  let total = 0;
  for (const t of txs) {
    if (t.status !== "confirmed" || t.type !== "expense") continue;
    if (txOrigin(t) === "credit_card") total += Number(t.amount || 0);
    if (t.settles_card_id) total -= Number(t.amount || 0);
  }
  return round2(Math.max(0, total));
}

export const EXCLUDED_MOVEMENT_KINDS = new Set([
  "internal_transfer",
  "investment_application",
  "investment_redemption",
]);

export function isRealMonthlyMovement(t: TransactionRow): boolean {
  if (t.status !== "confirmed") return false;
  if (t.type === "transfer") return false;
  const mk = (t.movement_kind ?? "transaction").toString();
  if (EXCLUDED_MOVEMENT_KINDS.has(mk)) return false;
  if (t.settles_card_id) return false;
  return true;
}

export function computeMonthlyTotals(txs: TransactionRow[], ym: string) {
  let income = 0, expense = 0;
  for (const t of txs) {
    if (!t.occurred_at.startsWith(ym)) continue;
    if (!isRealMonthlyMovement(t)) continue;
    const amt = Number(t.amount || 0);
    const mk = (t.movement_kind ?? "transaction").toString();
    if (mk === "refund") { expense -= amt; continue; }
    if (t.type === "income") income += amt;
    else if (t.type === "expense") expense += amt;
  }
  expense = Math.max(0, expense);
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

export function nextRecurringOccurrences(recurring: RecurringRow[], horizonDays: number, today = new Date()) {
  const result: { id: string; name: string; type: "income" | "expense"; amount: number; date: string }[] = [];
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0);
  const t1 = new Date(t0); t1.setDate(t1.getDate() + horizonDays);
  for (const r of recurring) {
    if (!r.active) continue;
    const cursor = new Date(r.next_due_date + "T00:00:00");
    let guard = 0;
    while (cursor <= t1 && guard++ < 400) {
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

export interface BeforeSpendingArgs {
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

export interface BeforeSpendingResult {
  totalCash: number;
  accountBalance: number | null;
  upcomingExpense: number;
  upcomingIncome: number;
  availableAfter: number;
  goalsAtRisk: { id: string; name: string; remaining: number }[];
  assumptions: string[];
  missingData: string[];
}

export function computeBeforeSpending(a: BeforeSpendingArgs): BeforeSpendingResult {
  const horizonDays = a.horizonDays ?? 30;
  const balances = computeAccountBalances(a.accounts, a.txs);
  const totalCash = round2(Object.values(balances).reduce((s, b) => s + b, 0));
  const accountBalance = a.accountId ? balances[a.accountId] ?? 0 : null;
  const upcoming = nextRecurringOccurrences(a.recurring, horizonDays);
  const plannedFuture = a.txs.filter(t => t.status === "planned" && t.type !== "transfer")
    .map(t => ({ type: t.type as "income"|"expense", amount: Number(t.amount) }));
  const upExp = round2(
    upcoming.filter(u => u.type === "expense").reduce((s, u) => s + u.amount, 0)
    + plannedFuture.filter(p => p.type === "expense").reduce((s, p) => s + p.amount, 0)
  );
  const upInc = round2(
    upcoming.filter(u => u.type === "income").reduce((s, u) => s + u.amount, 0)
    + plannedFuture.filter(p => p.type === "income").reduce((s, p) => s + p.amount, 0)
  );
  const availableAfter = round2(totalCash - a.amount - upExp + upInc);

  const goalsAtRisk: { id: string; name: string; remaining: number }[] = [];
  for (const g of a.goals.filter(x => x.status === "active")) {
    const contributed = a.contributions.filter(c => c.goal_id === g.id).reduce((s, c) => s + Number(c.amount), 0);
    const remaining = round2(Math.max(0, Number(g.target_amount) - contributed));
    if (remaining > 0 && availableAfter < remaining * 0.1) {
      goalsAtRisk.push({ id: g.id, name: g.name, remaining });
    }
  }

  const activeDebts = a.debts.filter(d => d.status === "active");
  const assumptions = [
    `Saldo total considera ${a.accounts.filter(x => x.active).length} conta(s) ativa(s).`,
    `Compromissos previstos no horizonte de ${horizonDays} dias (recorrências + planejados).`,
    "Transferências entre contas não afetam o saldo total.",
  ];
  const missingData: string[] = [];
  if (a.accounts.length === 0) missingData.push("Nenhuma conta cadastrada — o cálculo assume saldo zero.");
  if (a.recurring.length === 0) missingData.push("Sem recorrências cadastradas — compromissos futuros podem estar subestimados.");
  if (activeDebts.length > 0 && activeDebts.every(d => !d.installment_amount)) {
    missingData.push("Dívidas ativas sem parcela informada — impacto mensal não incluído.");
  }

  return { totalCash, accountBalance, upcomingExpense: upExp, upcomingIncome: upInc, availableAfter, goalsAtRisk, assumptions, missingData };
}
