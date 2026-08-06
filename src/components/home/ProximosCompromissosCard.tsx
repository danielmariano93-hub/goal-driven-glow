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
    <section aria-labelledby="commitments-title" className="rounded-[18px] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-primary">O que já tem data</p>
          <h2 id="commitments-title" className="mt-0.5 font-display text-base font-bold leading-5 text-foreground">Próximos compromissos</h2>
        </div>
        <CalendarBlank size={20} className="text-muted-foreground" weight="duotone" aria-hidden="true" />
      </div>
      {loading ? <div className="mt-4 h-24 animate-pulse rounded-2xl bg-muted" /> : availability === "unavailable" ? (
        <div className="mt-4"><p className="text-sm text-muted-foreground">Ainda não conseguimos verificar seus compromissos.</p><Button asChild variant="ghost" className="mt-2 min-h-11 px-0 text-primary"><Link to="/app/recorrencias">Revisar informações <ArrowRight /></Link></Button></div>
      ) : expenses.length === 0 ? (
        <p className="mt-2.5 text-[13px] leading-[19px] text-muted-foreground">Não identificamos compromissos futuros confirmados.</p>
      ) : (
        <div className="mt-2 divide-y divide-border">
          {expenses.map((item) => (
            <div key={`${item.id}-${item.date}`} className="flex min-h-14 items-center gap-2.5 py-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Receipt size={17} weight="duotone" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-foreground">{item.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">Vence em {formatDate(item.date)} · A pagar</p></div>
              <strong className="shrink-0 font-display text-[13px] font-bold tabular-nums text-foreground">{formatBRL(item.amount)}</strong>
            </div>
          ))}
        </div>
      )}
      {availability === "partial" ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><CreditCard size={16} /> Alguns dados ainda estão sendo atualizados.</p> : null}
      <Button asChild variant="ghost" size="sm" className="mt-1 min-h-10 w-full justify-between px-0 text-[13px] text-primary"><Link to="/app/recorrencias">Ver todos os compromissos <ArrowRight /></Link></Button>
    </section>
  );
}