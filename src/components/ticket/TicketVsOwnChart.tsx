import { useState } from "react";
import { formatBRL } from "@/lib/engine/facts";
import type { FoodSourceCycle } from "@/lib/engine/benefitWallet";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const range = (c: FoodSourceCycle, today: string) => `${dm(c.start)} a ${dm(c.partial ? today : c.end)}`;
const brl0 = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

/** Alimentação por ciclo do Ticket (recarga a recarga): cada barra é 100% e mostra a parte paga com Ticket (roxo) e com dinheiro próprio (lilás). */
export function TicketVsOwnChart({ cycles: months, today }: { cycles: FoodSourceCycle[]; today: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked ?? months.length - 1;
  const d = months[sel];
  const prev = sel > 0 ? months[sel - 1] : null;
  if (!d) return null;
  const pp = prev && prev.total > 0 ? d.ticket_pct - prev.ticket_pct : null;
  const diff = prev ? d.own - prev.own : 0;
  return (
    <section className="surface-card flex flex-col gap-4 p-5" data-testid="ticket-vs-own">
      <div className="flex items-baseline justify-between"><h2 className="font-bold">Ticket ou bolso</h2><span className="text-xs text-muted-foreground">alimentação por ciclo</span></div>
      <div>
        <div className="text-xs text-muted-foreground">Alimentação paga com Ticket no ciclo de {range(d, today)}{d.partial ? " (em andamento)" : ""}</div>
        {d.incomplete && d.data_from && <div data-testid="ticket-vs-own-incomplete" className="mt-1 rounded-lg bg-warning/20 px-2.5 py-1.5 text-xs text-foreground">Ciclo incompleto: o Nino só tem lançamentos do Ticket a partir de {dm(d.data_from)} e não tem a recarga deste ciclo.</div>}
        <div className="flex items-center gap-2">
          <span className="text-[28px] font-bold tabular-nums">{d.total > 0 ? `${d.ticket_pct}%` : "—"}</span>
          {pp !== null && d.total > 0 && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${pp >= 0 ? "bg-success/15 text-success" : "bg-warning/20 text-foreground"}`}>
              {pp > 0 ? "+" : ""}{pp} p.p. vs ciclo anterior
            </span>
          )}
        </div>
      </div>
      <div role="group" aria-label="Parte da alimentação paga com Ticket e com dinheiro próprio, por ciclo do Ticket. Toque num ciclo para ver os valores." className="flex h-56 gap-2.5">
        {months.map((m, i) => {
          const on = i === sel;
          return (
            <button key={m.start} type="button" aria-pressed={on} onClick={() => setPicked(i)}
              aria-label={`Ciclo de ${range(m, today)}: Ticket ${m.ticket_pct}% (${formatBRL(m.ticket)}), dinheiro próprio ${m.own_pct}% (${formatBRL(m.own)})`}
              className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
              <span className={`flex w-full flex-1 flex-col overflow-hidden rounded-xl transition-opacity ${on ? "opacity-100" : "opacity-55"}`}>
                {m.total === 0 ? (
                  <span className="flex flex-1 items-center justify-center bg-muted text-xs text-muted-foreground">sem gastos</span>
                ) : (
                  <>
                    {m.own > 0 && (
                      <span className="flex min-h-0 flex-col items-center justify-center bg-gradient-to-b from-[#EDE7FF] to-[#D6C8FF] text-[#4B3A86] dark:from-[#3A3156] dark:to-[#4C4072] dark:text-[#E4DCFF]" style={{ flexGrow: m.own_pct }}>
                        <span className="text-[13px] font-bold tabular-nums">{m.own_pct}%</span>
                        {m.own_pct >= 22 && <span className="text-[10px] tabular-nums opacity-85">{brl0(m.own)}</span>}
                      </span>
                    )}
                    {m.ticket > 0 && (
                      <span className="flex min-h-0 flex-col items-center justify-center bg-gradient-to-b from-[#9A6BFF] to-primary text-white" style={{ flexGrow: m.ticket_pct }}>
                        <span className="text-[13px] font-bold tabular-nums">{m.ticket_pct}%</span>
                        {m.ticket_pct >= 22 && <span className="text-[10px] tabular-nums opacity-85">{brl0(m.ticket)}</span>}
                      </span>
                    )}
                  </>
                )}
              </span>
              <span className={`text-center text-xs ${on ? "font-bold text-primary" : "text-muted-foreground"}`}>{monthName(m.label_month).slice(0, 3)}{m.partial ? "*" : ""}{m.incomplete ? "†" : ""}</span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-gradient-to-b from-[#9A6BFF] to-primary" />Ticket</span>
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-border bg-gradient-to-b from-[#EDE7FF] to-[#D6C8FF] dark:from-[#3A3156] dark:to-[#4C4072]" />Dinheiro próprio</span>
      </div>
      <div data-testid="ticket-vs-own-detail" className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3 text-[13px] tabular-nums">
        <div className="flex justify-between"><span>Ticket</span><span><strong className="font-semibold">{formatBRL(d.ticket)}</strong> · {d.ticket_pct}%</span></div>
        <div className="flex justify-between"><span>Dinheiro próprio</span><span><strong className="font-semibold">{formatBRL(d.own)}</strong> · {d.own_pct}%</span></div>
        <div className="flex justify-between"><span>Total em alimentação</span><strong className="font-semibold">{formatBRL(d.total)}</strong></div>
      </div>
      {prev && prev.total > 0 && d.total > 0 && (
        <p className="text-[13px] leading-relaxed">
          {d.ticket_pct >= prev.ticket_pct
            ? <><strong className="font-semibold">Mais comida no Ticket.</strong> Do seu bolso saíram {formatBRL(d.own)}{d.partial ? " até agora" : ""}{diff < 0 ? `, ${formatBRL(-diff)} a menos que no ciclo anterior` : ""}.</>
            : <><strong className="font-semibold">Mais comida no bolso.</strong> O Ticket cobriu {d.ticket_pct}%, contra {prev.ticket_pct}% no ciclo anterior. Do seu bolso saíram {formatBRL(d.own)}.</>}
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">Cada barra é um ciclo do Ticket, da recarga até a véspera da próxima, com o nome do mês em que termina. Dinheiro próprio: contas e cartões nas categorias de alimentação e mercado, pela data da compra.{months.some((m) => m.partial) ? " * ciclo em andamento." : ""}{months.some((m) => m.incomplete) ? " † ciclo com dados incompletos." : ""}</p>
    </section>
  );
}
