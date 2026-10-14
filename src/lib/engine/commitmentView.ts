// Visão de leitura dos compromissos (Home e página): janela curta + estado de pagamento legível.
import type { CommitmentItem } from "./commitmentAgenda";

const MS_DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / MS_DAY);

/** Último dia da janela: fim do mês corrente + primeira semana (7 dias) do mês seguinte. */
export function commitmentWindowEnd(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)); // dia 1 do mês seguinte
  nextMonth.setUTCDate(7);
  return nextMonth.toISOString().slice(0, 10);
}

export type CommitmentStatusView =
  | { kind: "paid"; label: string }
  | { kind: "overdue"; label: string; days: number }
  | { kind: "today"; label: string }
  | { kind: "upcoming"; label: string; days: number }
  | { kind: "partial"; label: string };

/** Rótulo de estado: pago / em atraso há N dias / vence hoje / vence em N dias. */
export function commitmentStatus(item: Pick<CommitmentItem, "date" | "payment_status" | "type">, today: string): CommitmentStatusView {
  if (item.payment_status === "paid") return { kind: "paid", label: item.type === "income" ? "Recebido" : "Pago" };
  const diff = daysBetween(today, item.date);
  if (item.payment_status === "partial") return { kind: "partial", label: "Parcialmente pago" };
  if (diff < 0 || item.payment_status === "overdue") {
    const days = Math.max(1, Math.abs(diff));
    return { kind: "overdue", days, label: `Em atraso há ${days} ${days === 1 ? "dia" : "dias"}` };
  }
  if (diff === 0) return { kind: "today", label: "Vence hoje" };
  if (diff === 1) return { kind: "upcoming", days: 1, label: "Vence amanhã" };
  return { kind: "upcoming", days: diff, label: `Vence em ${diff} dias` };
}

/**
 * Só o que interessa agora: atrasados em aberto, o que vence de hoje até a janela, e o já pago que
 * ainda está à frente (pago adiantado). Ordem: atrasados, próximos por data, pagos no fim.
 */
export function upcomingCommitments(items: CommitmentItem[], today: string): CommitmentItem[] {
  const end = commitmentWindowEnd(today);
  const rank = (i: CommitmentItem) => (i.payment_status === "paid" ? 2 : i.date < today ? 0 : 1);
  return items
    .filter((i) => {
      const d = i.date.slice(0, 10);
      if (d > end) return false;
      if (i.payment_status === "paid") return d >= today;
      return true; // em aberto: atrasado ou dentro da janela
    })
    .sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || b.amount - a.amount);
}
