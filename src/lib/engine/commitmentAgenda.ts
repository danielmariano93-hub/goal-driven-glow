// AGENDA CANÔNICA DE COMPROMISSOS — commitment_agenda.v2
// ======================================================
// Fonte ÚNICA de "o que já tem data" no Meu Nino. Consolida, com deduplicação
// rigorosa e sem dupla contagem:
//   1. faturas de cartão com vencimento no horizonte (precedência oficial)
//   2. parcelas de competências futuras que ainda NÃO estão dentro de fatura
//   3. recorrências ativas previstas
//   4. lançamentos planejados (exceto pagamentos de fatura)
//   5. parcelas de dívidas ativas (fora do cartão)
//
// Regras invioláveis:
//  - Uma obrigação aparece UMA única vez. Fatura oficial vence parcela estimada.
//  - Pagamento de fatura planejado (settles_card_id) nunca soma com a fatura.
//  - Nada aqui faz I/O: cálculo determinístico e testável.
import { round2, todayISO, nextRecurringOccurrences, type RecurringRow, type TransactionRow } from "./facts";
import { isAuthoritativeCardStatement } from "./cardExposure";
import { civilAddDays, civilDueDateForCompetence, civilDueDateInMonthOf } from "./civilDate";
import { computeDebtStatus, type DebtPaymentRow, type DebtScheduleRow } from "./debtStatus";

export const COMMITMENT_AGENDA_VERSION = "commitment_agenda.v3";

export type CommitmentSource =
  | "card_statement"
  | "card_installment"
  | "recurring"
  | "planned"
  | "debt_installment"
  | "donation_goal";

/** Estado real de pagamento da obrigação (fonte: debt_obligation.v1). */
export type CommitmentPaymentStatus = "pending" | "paid" | "partial" | "overdue";

export interface CommitmentItem {
  id: string;
  name: string;
  type: "income" | "expense";
  amount: number;
  date: string;
  source: CommitmentSource;
  /** true quando o valor não vem de documento oficial (fatura fechada). */
  estimated: boolean;
  /** identificador lógico usado na deduplicação. */
  dedupKey: string;
  /** Estado real de pagamento. Itens `paid` NUNCA somam no total pendente. */
  payment_status: CommitmentPaymentStatus;
  paid_at?: string | null;
  source_payment_id?: string | null;
  next_due_date?: string | null;
}

export interface CommitmentAgenda {
  formulaVersion: string;
  horizonStart: string;
  horizonEnd: string;
  /** Todos os compromissos do horizonte, inclusive os já pagos (histórico). */
  items: CommitmentItem[];
  /** Somente o que ainda é saída futura — base da Home e das projeções. */
  pendingItems: CommitmentItem[];
  totalIncome: number;
  totalExpense: number;
  bySource: Record<CommitmentSource, number>;
  /** true quando algum item é estimativa (sem fatura oficial). */
  hasEstimates: boolean;
}

export interface AgendaStatementRow {
  id?: string;
  credit_card_id: string;
  competence_month: string;
  due_date?: string | null;
  stated_total?: number | null;
  outstanding_amount?: number | null;
  paid_amount?: number | null;
  status?: string | null;
}

export interface AgendaInstallmentRow {
  id?: string;
  credit_card_id: string;
  competence_month: string;
  amount: number;
  status?: string | null;
  absorbed_by_statement_id?: string | null;
  description?: string | null;
}

export interface AgendaCardRow {
  id: string;
  name?: string | null;
  due_day?: number | null;
}

export interface AgendaDebtRow {
  id: string;
  name: string;
  status: string;
  installment_amount?: number | null;
  due_day?: number | null;
  outstanding_balance?: number | null;
}

const SETTLED = new Set(["paid", "settled", "closed_paid"]);
const DEAD_INSTALLMENTS = new Set(["paid", "refunded", "cancelled", "reversed", "anticipated"]);

// Datas civis: nunca `new Date(ano, mês, dia)` (viraria 03/09 em runtime UTC).
function addDaysISO(iso: string, days: number): string {
  return civilAddDays(iso, days);
}

/** Vencimento previsto de uma competência de cartão, a partir do dia de vencimento. */
export function dueDateForCompetence(competenceMonth: string, dueDay?: number | null): string | null {
  return civilDueDateForCompetence(competenceMonth, dueDay, 10);
}

/** Vencimento da parcela de dívida no mês de referência. */
function debtDueDate(refISO: string, dueDay?: number | null): string {
  return civilDueDateInMonthOf(refISO, dueDay, 10) ?? refISO.slice(0, 10);
}

export interface CommitmentAgendaInput {
  recurring: RecurringRow[];
  txs: TransactionRow[];
  statements?: AgendaStatementRow[];
  installments?: AgendaInstallmentRow[];
  cards?: AgendaCardRow[];
  debts?: AgendaDebtRow[];
  /** Pagamentos registrados de dívida: definem o estado real de cada ciclo. */
  debtPayments?: DebtPaymentRow[];
  /** Metas de doação já resolvidas em valor do mês (calculadas pelo motor). */
  donations?: { id: string; name: string; amount: number; date: string }[];
  horizonDays?: number;
  today?: Date;
}

export function computeCommitmentAgenda(input: CommitmentAgendaInput): CommitmentAgenda {
  const today = input.today ?? new Date();
  const todayIso = todayISO(today);
  const horizonDays = input.horizonDays ?? 30;
  const horizonIso = addDaysISO(todayIso, horizonDays);
  const inHorizon = (d: string) => d >= todayIso && d <= horizonIso;

  const cardById = new Map((input.cards ?? []).map((c) => [c.id, c]));
  const items: CommitmentItem[] = [];
  const seen = new Set<string>();
  const push = (item: Omit<CommitmentItem, "payment_status"> & { payment_status?: CommitmentPaymentStatus }) => {
    if (seen.has(item.dedupKey)) return;
    seen.add(item.dedupKey);
    items.push({ ...item, payment_status: item.payment_status ?? "pending" });
  };

  // 1) Faturas oficiais com vencimento no horizonte -------------------------
  const officialCompetences = new Set<string>();
  for (const st of input.statements ?? []) {
    const competence = String(st.competence_month || "").slice(0, 7);
    if (!competence) continue;
    // Placeholder vazio não absorve/suprime parcelas conhecidas.
    if (!isAuthoritativeCardStatement(st)) continue;
    officialCompetences.add(`${st.credit_card_id}:${competence}`);
    if (SETTLED.has(String(st.status ?? "").toLowerCase())) continue;
    const due = st.due_date ? String(st.due_date).slice(0, 10) : dueDateForCompetence(competence, cardById.get(st.credit_card_id)?.due_day);
    if (!due || !inHorizon(due)) continue;
    const amount = round2(
      st.outstanding_amount != null
        ? Number(st.outstanding_amount)
        : Math.max(0, Number(st.stated_total ?? 0) - Number(st.paid_amount ?? 0)),
    );
    if (amount <= 0) continue;
    const cardName = cardById.get(st.credit_card_id)?.name ?? "Cartão";
    push({
      id: st.id ?? `${st.credit_card_id}-${competence}`,
      name: `Fatura ${cardName}`,
      type: "expense",
      amount,
      date: due,
      source: "card_statement",
      estimated: false,
      dedupKey: `card_statement:${st.credit_card_id}:${competence}`,
    });
  }

  // 2) Parcelas de competências SEM fatura oficial ---------------------------
  const installmentByKey = new Map<string, number>();
  for (const inst of input.installments ?? []) {
    const competence = String(inst.competence_month || "").slice(0, 7);
    if (!competence) continue;
    if (inst.absorbed_by_statement_id) continue;
    if (DEAD_INSTALLMENTS.has(String(inst.status ?? "").toLowerCase())) continue;
    const key = `${inst.credit_card_id}:${competence}`;
    if (officialCompetences.has(key)) continue; // já dentro da fatura oficial
    installmentByKey.set(key, round2((installmentByKey.get(key) ?? 0) + Number(inst.amount || 0)));
  }
  for (const [key, amount] of installmentByKey) {
    if (amount <= 0) continue;
    const [cardId, competence] = key.split(":");
    const due = dueDateForCompetence(competence, cardById.get(cardId)?.due_day);
    if (!due || !inHorizon(due)) continue;
    push({
      id: key,
      name: `Parcelas ${cardById.get(cardId)?.name ?? "cartão"}`,
      type: "expense",
      amount,
      date: due,
      source: "card_installment",
      estimated: true,
      dedupKey: `card_installment:${key}`,
    });
  }

  // 3) Lançamentos planejados (antes das recorrências: têm precedência) ------
  for (const t of input.txs) {
    if (t.status !== "planned") continue;
    if (t.type === "transfer") continue;
    if (t.settles_card_id) continue; // pagamento de fatura já contado no item da fatura
    const date = String(t.occurred_at || "").slice(0, 10);
    if (!inHorizon(date)) continue;
    const amount = round2(Number(t.amount || 0));
    push({
      id: t.id,
      name: t.description || "Compromisso",
      type: t.type as "income" | "expense",
      amount,
      date,
      source: "planned",
      estimated: false,
      dedupKey: `obligation:${date}:${amount.toFixed(2)}:${(t.description || "").trim().toLowerCase()}`,
    });
  }

  // 4) Recorrências previstas ----------------------------------------------
  for (const occ of nextRecurringOccurrences(input.recurring, horizonDays, today)) {
    if (!inHorizon(occ.date)) continue;
    const amount = round2(Number(occ.amount || 0));
    push({
      id: occ.id,
      name: occ.name,
      type: occ.type,
      amount,
      date: occ.date,
      source: "recurring",
      estimated: true,
      dedupKey: `obligation:${occ.date}:${amount.toFixed(2)}:${occ.name.trim().toLowerCase()}`,
    });
  }

  // 5) Parcelas de dívidas ativas ------------------------------------------
  // Estado de pagamento vem da MESMA regra canônica usada pelo diagnóstico
  // (debt_status.v3 / debt_obligation.v1) — a agenda não recalcula nada.
  const debtRows = (input.debts ?? []) as unknown as DebtScheduleRow[];
  const debtState = new Map<string, ReturnType<typeof computeDebtStatus>["breakdown"][number]>();
  if (debtRows.length > 0) {
    const status = computeDebtStatus({
      debts: debtRows,
      payments: input.debtPayments ?? [],
      today: todayIso,
    });
    for (const item of status.breakdown) debtState.set(item.debt_id, item);
  }

  for (const debt of input.debts ?? []) {
    if (String(debt.status) !== "active") continue;
    const installment = round2(Number(debt.installment_amount || 0));
    if (installment <= 0) continue;
    const canonical = debtState.get(debt.id);
    const currentCycleDue = debtDueDate(todayIso, debt.due_day);
    const candidates = [currentCycleDue, debtDueDate(addDaysISO(todayIso, 31), debt.due_day)];
    for (const due of candidates) {
      if (!inHorizon(due)) continue;
      // O ciclo corrente só é "pendente" se o motor canônico não o considerar pago.
      const cyclePaid = canonical
        ? Boolean(canonical.next_due_date && due < canonical.next_due_date && canonical.situation !== "em_atraso")
        : false;
      const status: CommitmentPaymentStatus = cyclePaid
        ? "paid"
        : canonical?.situation === "em_atraso" && due <= todayIso
          ? "overdue"
          : "pending";
      push({
        id: `${debt.id}-${due}`,
        name: `Parcela ${debt.name}`,
        type: "expense",
        amount: installment,
        date: due,
        source: "debt_installment",
        estimated: true,
        dedupKey: `debt:${debt.id}:${due.slice(0, 7)}`,
        payment_status: status,
        paid_at: cyclePaid ? canonical?.last_payment_at ?? null : null,
        next_due_date: canonical?.next_due_date ?? null,
      });
    }
  }

  // 6) Metas de doação do mês -------------------------------------------------
  for (const donation of input.donations ?? []) {
    const amount = round2(Number(donation.amount || 0));
    if (amount <= 0 || !inHorizon(donation.date)) continue;
    push({
      id: donation.id,
      name: donation.name,
      type: "expense",
      amount,
      date: donation.date,
      source: "donation_goal",
      estimated: true,
      dedupKey: `donation:${donation.id}:${donation.date.slice(0, 7)}`,
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  const bySource: Record<CommitmentSource, number> = {
    card_statement: 0,
    card_installment: 0,
    recurring: 0,
    planned: 0,
    debt_installment: 0,
    donation_goal: 0,
  };
  let totalIncome = 0;
  let totalExpense = 0;
  for (const item of items) {
    // Compromisso já pago NÃO é saída futura: não soma em total nem por fonte.
    if (item.payment_status === "paid") continue;
    if (item.type === "income") totalIncome += item.amount;
    else {
      totalExpense += item.amount;
      bySource[item.source] = round2(bySource[item.source] + item.amount);
    }
  }

  const pendingItems = items.filter((i) => i.payment_status !== "paid");

  return {
    formulaVersion: COMMITMENT_AGENDA_VERSION,
    horizonStart: todayIso,
    horizonEnd: horizonIso,
    items,
    pendingItems,
    totalIncome: round2(totalIncome),
    totalExpense: round2(totalExpense),
    bySource,
    hasEstimates: pendingItems.some((i) => i.estimated),
  };
}
