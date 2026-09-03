import { useMemo } from "react";
import { CalendarDays, CreditCard, HandHeart, Landmark, Loader2, ReceiptText, Repeat2 } from "lucide-react";
import { useFinancialSnapshot } from "@/lib/hooks/useFinancialSnapshot";
import { formatBRL, todayISO } from "@/lib/engine/facts";
import type { CommitmentItem, CommitmentSource } from "@/lib/engine/commitmentAgenda";

const META: Record<CommitmentSource, { label: string; icon: typeof CreditCard }> = {
  card_statement: { label: "Fatura oficial", icon: CreditCard },
  card_installment: { label: "Parcelas conhecidas", icon: CreditCard },
  recurring: { label: "Conta recorrente", icon: Repeat2 },
  planned: { label: "Lançamento planejado", icon: ReceiptText },
  debt_installment: { label: "Parcela de dívida", icon: Landmark },
  donation_goal: { label: "Compromisso de doação", icon: HandHeart },
};

function dateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", {
    weekday: "short", day: "2-digit", month: "long",
  });
}

export default function Compromissos() {
  const today = todayISO();
  const [year, month] = today.split("-").map(Number);
  const end = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const snapshot = useFinancialSnapshot({ start: `${year}-${String(month).padStart(2, "0")}-01`, end });
  const items = snapshot.data?.commitmentAgenda.items ?? [];
  const expenses = items.filter((item) => item.type === "expense");
  const income = items.filter((item) => item.type === "income");
  const groups = useMemo(() => {
    const result = new Map<string, CommitmentItem[]>();
    for (const item of items) result.set(item.date, [...(result.get(item.date) ?? []), item]);
    return [...result.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);
  // Total destacado = o que ainda é cobrança. O que já foi pago aparece
  // separado, como histórico do período.
  const pendingExpenses = expenses.filter((item) => item.payment_status !== "paid");
  const expenseTotal = pendingExpenses.reduce((sum, item) => sum + item.amount, 0);
  const paidTotal = expenses.filter((item) => item.payment_status === "paid").reduce((sum, item) => sum + item.amount, 0);
  const incomeTotal = income.reduce((sum, item) => sum + item.amount, 0);


  return (
    <div className="space-y-4 pt-2">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Agenda financeira</p>
        <h1 className="mt-0.5 font-display text-2xl font-bold tracking-tight">Próximos compromissos</h1>
        <p className="mt-1 text-sm text-muted-foreground">Faturas, parcelas, contas e valores planejados em uma única linha do tempo.</p>
      </header>

      {snapshot.loading ? (
        <div className="surface-card grid min-h-40 place-items-center"><Loader2 className="animate-spin text-primary" /></div>
      ) : snapshot.error ? (
        <div className="surface-card p-5"><p className="text-sm font-semibold">Não foi possível carregar sua agenda.</p><button className="mt-2 text-sm font-semibold text-primary" onClick={() => void snapshot.refetch()}>Tentar novamente</button></div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Saídas ainda a pagar</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums">{formatBRL(expenseTotal)}</p>
              <p className="text-[10px] text-muted-foreground">
                {pendingExpenses.length} compromisso{pendingExpenses.length === 1 ? "" : "s"}
                {paidTotal > 0 ? ` · ${formatBRL(paidTotal)} já pago` : ""}
              </p>

            </div>
            <div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Entradas planejadas</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums text-success">{formatBRL(incomeTotal)}</p>
              <p className="text-[10px] text-muted-foreground">{income.length} entrada{income.length === 1 ? "" : "s"}</p>
            </div>
          </section>

          {groups.length === 0 ? (
            <section className="surface-card p-8 text-center">
              <CalendarDays className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 text-sm font-semibold">Nenhum compromisso identificado nos próximos 30 dias</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Quando houver parcelas, faturas, recorrências ou lançamentos planejados, eles aparecerão aqui automaticamente.</p>
            </section>
          ) : (
            <section className="surface-card overflow-hidden">
              {groups.map(([date, rows]) => (
                <div key={date} className="border-b border-border p-3.5 last:border-0">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-[12px] font-bold capitalize text-foreground">{dateLabel(date)}</h2>
                    <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{formatBRL(rows.reduce((sum, row) => sum + (row.type === "expense" ? -row.amount : row.amount), 0))}</span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {rows.map((item) => {
                      const meta = META[item.source];
                      const Icon = meta.icon;
                      return (
                        <li key={item.dedupKey} className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon size={15} /></span>
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-[12px]">{item.name}</strong>
                            <span className="text-[10px] text-muted-foreground">
                              {meta.label}
                              {item.payment_status === "paid"
                                ? " · pago"
                                : item.payment_status === "overdue"
                                  ? " · em atraso"
                                  : item.estimated ? " · valor estimado" : " · confirmado"}
                            </span>
                          </span>
                          <strong className={item.type === "income" ? "shrink-0 text-[12px] tabular-nums text-success" : "shrink-0 text-[12px] tabular-nums"}>{item.type === "income" ? "+" : "−"}{formatBRL(item.amount)}</strong>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {snapshot.partial ? <p className="text-[11px] text-muted-foreground">Agenda parcial: uma ou mais fontes ainda estão sendo atualizadas.</p> : null}
        </>
      )}
    </div>
  );
}
