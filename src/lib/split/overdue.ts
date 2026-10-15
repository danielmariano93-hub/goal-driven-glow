// Atraso de rolê: a verdade é a PARCELA (split_receivables_v1.state), não a data da divisão inteira.
// `shared_expenses.due_date` guarda o vencimento da 1ª parcela; olhar só para ele marca como atrasada uma divisão
// parcelada cujas parcelas vencidas já foram pagas e cuja próxima só vence no mês seguinte.

export type ReceivableLite = {
  shared_expense_id: string;
  state: string | null;
  due_date: string | null;
  phone_e164?: string | null;
  linked_user_id?: string | null;
};

export type SplitDueView = {
  overdue: boolean;
  /** Próximo vencimento ainda em aberto (parcelas não pagas e não canceladas). */
  nextDue: string | null;
  source: "installments" | "split_due_date";
};

const OPEN_STATES = new Set(["pending", "partial", "overdue"]);

export function splitDueView(args: {
  status: string;
  deleted?: boolean;
  splitDueDate: string | null;
  /** Parcelas que importam para quem olha (do dono: de externos; do participante: as dele). */
  receivables: ReceivableLite[] | undefined;
  today: string;
}): SplitDueView {
  if (args.deleted || args.status !== "active") return { overdue: false, nextDue: null, source: "installments" };
  const rows = args.receivables ?? [];
  if (rows.length > 0) {
    const open = rows.filter((r) => OPEN_STATES.has(String(r.state ?? "")));
    const dates = open.map((r) => r.due_date).filter((d): d is string => Boolean(d)).sort();
    return {
      overdue: open.some((r) => r.state === "overdue"),
      nextDue: dates[0] ?? null,
      source: "installments",
    };
  }
  // Sem parcelas materializadas (divisão antiga): só então vale a data da divisão.
  return {
    overdue: Boolean(args.splitDueDate && args.splitDueDate < args.today),
    nextDue: args.splitDueDate,
    source: "split_due_date",
  };
}

export function groupReceivables(rows: ReceivableLite[]): Map<string, ReceivableLite[]> {
  const map = new Map<string, ReceivableLite[]>();
  for (const r of rows) {
    const list = map.get(r.shared_expense_id) ?? [];
    list.push(r);
    map.set(r.shared_expense_id, list);
  }
  return map;
}
