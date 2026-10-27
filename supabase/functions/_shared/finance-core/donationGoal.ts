// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Meta de doação como compromisso mensal confirmado por lançamentos reais (`donation_goal.v1`).
// Cada mês tem um alvo (valor fixo ou % da renda que já entrou até o vencimento) e um realizado
// (despesas confirmadas na categoria da meta + lançamentos vinculados à mão). Núcleo puro, sem I/O.

export type DonationGoalLike = {
  id: string;
  name?: string | null;
  kind?: string | null;
  status?: string | null;
  created_at?: string | null;
  donation_mode?: string | null;
  donation_percent?: number | null;
  monthly_target?: number | null;
  donation_income_scope?: string | null;
  donation_income_category_ids?: string[] | null;
  donation_due_day?: number | null;
  donation_end_date?: string | null;
  donation_category_id?: string | null;
};

export type DonationTxLike = {
  id: string;
  type: string;
  status?: string | null;
  amount: number | string;
  occurred_at: string;
  category_id?: string | null;
  movement_kind?: string | null;
  donation_goal_id?: string | null;
};

export type DonationMonthStatus = "no_target" | "pending" | "partial" | "done" | "exceeded";

export type DonationMonth = {
  month: string;
  dueDate: string;
  target: number;
  done: number;
  remaining: number;
  status: DonationMonthStatus;
  matched: { id: string; amount: number; occurred_at: string; via: "category" | "link" }[];
};

const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");

export function isDonationGoal(goal: { kind?: string | null }): boolean {
  return String(goal.kind ?? "savings") === "donation";
}

/** Dia do compromisso no mês (1–28), como já é guardado na meta. */
export function donationDueDate(goal: DonationGoalLike, month: string): string {
  const day = Math.max(1, Math.min(28, Number(goal.donation_due_day ?? 25)));
  return `${month}-${pad(day)}`;
}

/**
 * Alvo do mês. Valor fixo: o próprio valor. Percentual: sobre a renda do mês que entrou até o vencimento
 * (depois do vencimento, nova renda não muda mais o alvo daquele mês).
 */
export function donationMonthTarget(goal: DonationGoalLike, month: string, txs: DonationTxLike[], todayIso?: string): number {
  if (String(goal.donation_mode) !== "income_percent") return round2(Number(goal.monthly_target ?? 0));
  const due = donationDueDate(goal, month);
  const cutoff = todayIso && todayIso < due ? todayIso : due;
  const selected = new Set(goal.donation_income_category_ids ?? []);
  const scoped = String(goal.donation_income_scope) === "selected_categories";
  const income = txs
    .filter((t) => t.type === "income" && String(t.status ?? "confirmed") === "confirmed")
    .filter((t) => String(t.movement_kind ?? "transaction") === "transaction")
    .filter((t) => t.occurred_at.slice(0, 7) === month && t.occurred_at <= cutoff)
    .filter((t) => !scoped || (t.category_id != null && selected.has(t.category_id)))
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
  return round2((income * Number(goal.donation_percent ?? 0)) / 100);
}

export function evaluateDonationMonth(goal: DonationGoalLike, month: string, txs: DonationTxLike[], todayIso?: string): DonationMonth {
  const matched: DonationMonth["matched"] = [];
  for (const t of txs) {
    if (t.type !== "expense" || String(t.status ?? "confirmed") !== "confirmed") continue;
    if (t.occurred_at.slice(0, 7) !== month) continue;
    if (String(t.movement_kind ?? "transaction") !== "transaction") continue;
    const byLink = t.donation_goal_id === goal.id;
    const byCategory = goal.donation_category_id != null && t.category_id === goal.donation_category_id;
    if (!byLink && !byCategory) continue;
    matched.push({ id: t.id, amount: round2(Number(t.amount || 0)), occurred_at: t.occurred_at, via: byLink ? "link" : "category" });
  }
  matched.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  const done = round2(matched.reduce((s, m) => s + m.amount, 0));
  const target = donationMonthTarget(goal, month, txs, todayIso);
  const remaining = round2(Math.max(0, target - done));
  let status: DonationMonthStatus;
  if (target <= 0) status = done > 0 ? "exceeded" : "no_target";
  else if (done <= 0) status = "pending";
  else if (done < target) status = "partial";
  else if (done > target + 0.005) status = "exceeded";
  else status = "done";
  return { month, dueDate: donationDueDate(goal, month), target, done, remaining, status, matched };
}

/** Meses de `from` até `to` (inclusive), em ordem decrescente, respeitando o fim da meta. */
export function donationMonthsRange(goal: DonationGoalLike, todayIso: string, maxMonths = 12): string[] {
  const end = todayIso.slice(0, 7);
  const startFrom = (goal.created_at ?? todayIso).slice(0, 7);
  const last = goal.donation_end_date && goal.donation_end_date.slice(0, 7) < end ? goal.donation_end_date.slice(0, 7) : end;
  const out: string[] = [];
  let [y, m] = last.split("-").map(Number);
  while (out.length < maxMonths) {
    const key = `${y}-${pad(m)}`;
    if (key < startFrom) break;
    out.push(key);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}
