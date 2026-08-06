import { ArrowRight, CalendarBlank, CreditCard, HandHeart, Receipt, Repeat, Bank } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/engine/facts";
import type { CommitmentItem, CommitmentSource } from "@/lib/engine/commitmentAgenda";

const SOURCE_META: Record<CommitmentSource, { label: string; icon: JSX.Element }> = {
  card_statement: { label: "Fatura do cartão", icon: <CreditCard size={17} weight="duotone" /> },
  card_installment: { label: "Parcelas do cartão", icon: <CreditCard size={17} weight="duotone" /> },
  recurring: { label: "Recorrência", icon: <Repeat size={17} weight="duotone" /> },
  planned: { label: "Planejado", icon: <Receipt size={17} weight="duotone" /> },
  debt_installment: { label: "Parcela de dívida", icon: <Bank size={17} weight="duotone" /> },
  donation_goal: { label: "Meta de doação", icon: <HandHeart size={17} weight="duotone" /> },
};

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function ProximosCompromissosCard({ commitments, availability, loading }: {
  commitments: CommitmentItem[];
  availability: "available" | "partial" | "unavailable";
  loading?: boolean;
}) {
  const expenses = commitments.filter((item) => item.type === "expense");
  const visible = expenses.slice(0, 4);
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);

  return (
    <section aria-labelledby="commitments-title" className="rounded-[18px] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-primary">O que já tem data</p>
          <h2 id="commitments-title" className="mt-0.5 font-display text-base font-bold leading-5 text-foreground">Próximos compromissos</h2>
        </div>
        <CalendarBlank size={20} className="text-muted-foreground" weight="duotone" aria-hidden="true" />
      </div>

      {loading ? <div className="mt-4 h-24 animate-pulse rounded-2xl bg-muted" /> : availability === "unavailable" ? (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">Ainda não conseguimos verificar seus compromissos.</p>
          <Button asChild variant="ghost" className="mt-2 min-h-11 px-0 text-primary"><Link to="/app/recorrencias">Revisar informações <ArrowRight /></Link></Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-2.5 text-[13px] leading-[19px] text-muted-foreground">Não identificamos compromissos com data nos próximos 30 dias.</p>
      ) : (
        <>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {expenses.length} compromisso{expenses.length === 1 ? "" : "s"} · {formatBRL(total)} até {formatDate(expenses[expenses.length - 1].date)}
          </p>
          <div className="mt-1.5 divide-y divide-border">
            {visible.map((item) => (
              <div key={`${item.dedupKey}`} className="flex min-h-14 items-center gap-2.5 py-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">{SOURCE_META[item.source].icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-foreground">{item.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDate(item.date)} · {SOURCE_META[item.source].label}{item.estimated ? " · previsto" : " · confirmado"}
                  </p>
                </div>
                <strong className="shrink-0 font-display text-[13px] font-bold tabular-nums text-foreground">{formatBRL(item.amount)}</strong>
              </div>
            ))}
          </div>
        </>
      )}

      {availability === "partial" ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><CreditCard size={16} /> Alguns dados ainda estão sendo atualizados.</p> : null}
      <Button asChild variant="ghost" size="sm" className="mt-1 min-h-10 w-full justify-between px-0 text-[13px] text-primary"><Link to="/app/recorrencias">Ver todos os compromissos <ArrowRight /></Link></Button>
    </section>
  );
}
