import { formatBRL } from "@/lib/engine/facts";
import { deltaMoney, type Performance } from "@/lib/engine/ticketAnalytics";
import { dm, pct1 } from "./sourceStyle";

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
const money = (n: number) => formatBRL(Math.abs(n));

function moneyDelta(cur: number, prev: number | null): string | null {
  const d = deltaMoney(cur, prev);
  if (!d) return null;
  if (d.kind === "none") return "sem variação";
  if (d.kind === "new") return "novo gasto";
  return `${sign(d.abs)}${money(d.abs)}${d.pct !== null ? ` (${sign(d.pct)}${Math.abs(d.pct)}%)` : ""}`;
}

/** Desempenho comparativo em 2×2: cobertura, desembolso próprio, alimentação total e ritmo do Ticket.
 *  Variação discreta e neutra junto ao número (sem verde só porque a cobertura subiu). */
export function PerformanceGrid({ perf, title }: { perf: Performance; title: string }) {
  const { current: c, previous: p } = perf;
  const prevLabel = p ? `${dm(p.from)} a ${dm(p.to)}` : null;
  const ppDelta = p && c.coverage_pct !== null && p.coverage_pct !== null ? Math.round(c.coverage_pct - p.coverage_pct) : null;
  const closedDiffLen = p && !perf.cycle.open && !p.same_days;
  const tiles = [
    { k: "Cobertura do Ticket", v: c.coverage_pct === null ? "—" : pct1(c.coverage_pct), d: ppDelta === null ? null : ppDelta === 0 ? "sem variação" : `${sign(ppDelta)}${Math.abs(ppDelta)} p.p.`, hint: "parte da alimentação paga com Ticket" },
    { k: "Desembolso próprio", v: formatBRL(c.own), d: p ? moneyDelta(c.own, p.own) : null, hint: "alimentação paga com conta ou cartão" },
    { k: "Alimentação total", v: formatBRL(c.total), d: p ? moneyDelta(c.total, p.total) : null, hint: "Ticket + bolso" },
    perf.cycle.open
      ? { k: "Ritmo do Ticket", v: c.ticket_per_day === null ? "—" : `${formatBRL(c.ticket_per_day)}/dia`, d: p && p.ticket_per_day !== null && c.ticket_per_day !== null ? moneyDelta(c.ticket_per_day, p.ticket_per_day) : null, hint: `${c.days} dias observados` }
      : { k: "Pago com Ticket", v: formatBRL(c.ticket), d: p ? moneyDelta(c.ticket, p.ticket) : null, hint: closedDiffLen ? `ciclo de ${c.days} dias; anterior de ${p!.days}` : `${c.days} dias` },
  ];
  return (
    <section className="surface-card flex flex-col gap-3 p-5" data-testid="ticket-performance">
      <div className="flex flex-col">
        <h2 className="font-bold">{title}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {dm(perf.window.from)} a {dm(perf.window.to)}{p ? ` · comparado com ${prevLabel}${perf.cycle.open ? " (mesmos dias do ciclo anterior)" : ""}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <div key={t.k} className="rounded-xl bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground">{t.k}</div>
            <div className="mt-0.5 text-[20px] font-bold tabular-nums leading-tight">{t.v}</div>
            {t.d && <div className="text-xs tabular-nums text-muted-foreground">{t.d}</div>}
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t.hint}</div>
          </div>
        ))}
      </div>
      {!p && (
        <p className="text-xs text-muted-foreground">
          {perf.unavailable_reason === "previous_incomplete" ? "Comparação indisponível: o ciclo anterior está incompleto." : "Comparação indisponível: ainda não há ciclo anterior."}
        </p>
      )}
    </section>
  );
}
