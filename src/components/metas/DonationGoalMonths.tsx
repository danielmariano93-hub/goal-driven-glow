import { useMemo, useState } from "react";
import { CheckCircle2, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { useLinkDonationTransaction } from "@/lib/db/finance";
import {
  donationMonthsRange, evaluateDonationMonth, type DonationGoalLike, type DonationMonth, type DonationMonthStatus,
} from "@/lib/engine/donationGoal";
import { formatBRL, todayISO } from "@/lib/engine/facts";

type Tx = {
  id: string; type: string; status?: string | null; amount: number | string; occurred_at: string;
  category_id?: string | null; movement_kind?: string | null; donation_goal_id?: string | null;
  description?: string | null; friendly_description?: string | null;
};

const MONTH_FMT = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
export const monthLabel = (month: string) => {
  const label = MONTH_FMT.format(new Date(`${month}-15T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const STATUS: Record<DonationMonthStatus, { label: string; tone: string }> = {
  done: { label: "Cumprido", tone: "text-success" },
  exceeded: { label: "Acima do combinado", tone: "text-success" },
  partial: { label: "Parcial", tone: "text-warning" },
  pending: { label: "Pendente", tone: "text-muted-foreground" },
  no_target: { label: "Sem valor definido", tone: "text-muted-foreground" },
};

export function donationSummaryLine(m: DonationMonth): string {
  if (m.status === "no_target") return m.done > 0 ? `${formatBRL(m.done)} destinados` : "Sem valor definido para o mês";
  return `${formatBRL(m.done)} de ${formatBRL(m.target)}`;
}

/** Resumo de uma linha para o card da meta: só o mês atual. */
export function DonationCurrentMonth({ goal, txs }: { goal: DonationGoalLike; txs: Tx[] }) {
  const today = todayISO();
  const month = useMemo(() => evaluateDonationMonth(goal, today.slice(0, 7), txs, today), [goal, txs, today]);
  const st = STATUS[month.status];
  return (
    <div className="mt-2 rounded-xl bg-success/10 px-3 py-2 text-[11px] leading-4">
      <p className={`font-semibold ${st.tone}`}>
        {monthLabel(month.month)} · {st.label}
      </p>
      <p className="text-muted-foreground">{donationSummaryLine(month)}</p>
    </div>
  );
}

/** Histórico mês a mês da meta de doação, com vínculo manual de lançamentos. */
export function DonationGoalMonths({ goal, txs }: { goal: DonationGoalLike; txs: Tx[] }) {
  const link = useLinkDonationTransaction();
  const [picking, setPicking] = useState<string | null>(null);
  const today = todayISO();
  const months = useMemo(
    () => donationMonthsRange(goal, today).map((m) => evaluateDonationMonth(goal, m, txs, today)),
    [goal, txs, today],
  );
  const byId = useMemo(() => new Map(txs.map((t) => [t.id, t])), [txs]);

  const candidates = (month: string, matchedIds: Set<string>) =>
    txs
      .filter((t) => t.type === "expense" && String(t.status ?? "confirmed") === "confirmed")
      .filter((t) => String(t.movement_kind ?? "transaction") === "transaction")
      .filter((t) => t.occurred_at.slice(0, 7) === month && !matchedIds.has(t.id) && !t.donation_goal_id)
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 20);

  const apply = (transactionId: string, goalId: string | null) =>
    link.mutate({ transactionId, goalId }, {
      onSuccess: () => { toast.success(goalId ? "Lançamento vinculado à meta" : "Vínculo removido"); setPicking(null); },
      onError: () => toast.error("Não consegui atualizar o vínculo agora."),
    });

  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">Mês a mês</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Conta a despesa que você já lançou, sem criar outro lançamento.
        {goal.donation_category_id ? " Despesas na categoria da meta entram sozinhas." : " Vincule o lançamento do mês à mão."}
      </p>
      <ul className="mt-3 space-y-3">
        {months.map((m) => {
          const st = STATUS[m.status];
          const matchedIds = new Set(m.matched.map((x) => x.id));
          return (
            <li key={m.month} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{monthLabel(m.month)}</span>
                <span className={`inline-flex items-center gap-1 text-xs font-semibold ${st.tone}`}>
                  {m.status === "done" || m.status === "exceeded" ? <CheckCircle2 size={13} /> : null}{st.label}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{donationSummaryLine(m)}</p>
              {m.matched.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {m.matched.map((x) => {
                    const tx = byId.get(x.id);
                    return (
                      <li key={x.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {new Date(`${x.occurred_at}T12:00:00`).toLocaleDateString("pt-BR")} · {tx?.friendly_description || tx?.description || "Lançamento"}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-semibold tabular-nums">{formatBRL(x.amount)}</span>
                          {x.via === "link" && (
                            <button type="button" aria-label="Desvincular lançamento" disabled={link.isPending}
                              onClick={() => apply(x.id, null)} className="text-muted-foreground hover:text-destructive">
                              <Unlink size={13} />
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button type="button" onClick={() => setPicking(picking === m.month ? null : m.month)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] font-medium">
                <Link2 size={12} /> Vincular lançamento
              </button>
              {picking === m.month && (
                <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                  {candidates(m.month, matchedIds).length === 0 ? (
                    <li className="p-3 text-xs text-muted-foreground">Nenhuma despesa deste mês disponível para vincular.</li>
                  ) : candidates(m.month, matchedIds).map((t) => (
                    <li key={t.id}>
                      <button type="button" disabled={link.isPending} onClick={() => apply(t.id, goal.id)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-secondary/60">
                        <span className="min-w-0 truncate">
                          {new Date(`${t.occurred_at}T12:00:00`).toLocaleDateString("pt-BR")} · {t.friendly_description || t.description || "Lançamento"}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">{formatBRL(Number(t.amount))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
