import { ArrowRight, CalendarBlank, CreditCard, Receipt } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/engine/facts";

type Commitment = { id: string; name: string; type: "income" | "expense"; amount: number; date: string };

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function ProximosCompromissosCard({ commitments, availability, loading }: {
  commitments: Commitment[];
  availability: "available" | "partial" | "unavailable";
  loading?: boolean;
}) {
  const expenses = commitments.filter((item) => item.type === "expense").slice(0, 3);
  return (
    <section aria-labelledby="commitments-title" className="rounded-[20px] border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-primary">O que já tem data</p>
          <h2 id="commitments-title" className="mt-1 font-display text-lg font-bold leading-6 text-foreground">Próximos compromissos</h2>
        </div>
        <CalendarBlank size={20} className="text-muted-foreground" weight="duotone" aria-hidden="true" />
      </div>
      {loading ? <div className="mt-4 h-24 animate-pulse rounded-2xl bg-muted" /> : availability === "unavailable" ? (
        <div className="mt-4"><p className="text-sm text-muted-foreground">Ainda não conseguimos verificar seus compromissos.</p><Button asChild variant="ghost" className="mt-2 min-h-11 px-0 text-primary"><Link to="/app/recorrencias">Revisar informações <ArrowRight /></Link></Button></div>
      ) : expenses.length === 0 ? (
        <p className="mt-4 text-sm leading-[21px] text-muted-foreground">Não identificamos compromissos futuros confirmados.</p>
      ) : (
        <div className="mt-4 divide-y divide-border">
          {expenses.map((item) => (
            <div key={`${item.id}-${item.date}`} className="flex min-h-16 items-center gap-3 py-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary text-primary"><Receipt size={19} weight="duotone" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{item.name}</p><p className="mt-0.5 text-xs text-muted-foreground">Vence em {formatDate(item.date)} · A pagar</p></div>
              <strong className="shrink-0 font-display text-sm font-bold tabular-nums text-foreground">{formatBRL(item.amount)}</strong>
            </div>
          ))}
        </div>
      )}
      {availability === "partial" ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><CreditCard size={16} /> Alguns dados ainda estão sendo atualizados.</p> : null}
      <Button asChild variant="ghost" className="mt-2 min-h-11 w-full justify-between px-0 text-primary"><Link to="/app/recorrencias">Ver todos os compromissos <ArrowRight /></Link></Button>
    </section>
  );
}