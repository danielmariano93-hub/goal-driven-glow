import { useState } from "react";
import { formatBRL } from "@/lib/engine/facts";
import type { FoodSourceCycle } from "@/lib/engine/benefitWallet";
import { OWN_FILL, OWN_TEXT, TICKET_FILL, brl0, dm, monthName } from "./sourceStyle";

const range = (c: FoodSourceCycle, today: string) => `${dm(c.start)} a ${dm(c.partial ? today : c.end)}`;

/** Alimentação por ciclo do Ticket (recarga a recarga). Modo %: barras de 100% com a parte do Ticket (roxo) e do
 *  dinheiro próprio (lilás). Modo R$: altura proporcional ao total, escala comum e base zero. A seleção é o ciclo
 *  escolhido na página; ciclo incompleto aparece com † e fica fora da comparação. */
export function TicketVsOwnChart({ cycles: months, today, selectedStart, onSelect }: {
  cycles: FoodSourceCycle[]; today: string; selectedStart?: string | null; onSelect?: (start: string) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [mode, setMode] = useState<"pct" | "brl">("pct");
  const controlled = selectedStart != null ? months.findIndex((m) => m.start === selectedStart) : -1;
  const sel = controlled >= 0 ? controlled : picked ?? months.length - 1;
  const d = months[sel];
  if (!d) return null;
  const prev = sel > 0 ? months[sel - 1] : null;
  const comparable = !!prev && !prev.incomplete && !d.incomplete && prev.total > 0 && d.total > 0;
  const pp = comparable ? d.ticket_pct - prev!.ticket_pct : null;
  const diff = comparable ? d.own - prev!.own : 0;
  const max = Math.max(1, ...months.map((m) => m.total));
  const choose = (i: number) => { setPicked(i); onSelect?.(months[i].start); };
  return (
    <section className="surface-card flex flex-col gap-4 p-5" data-testid="ticket-vs-own">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">Ticket ou bolso</h2>
        <div role="group" aria-label="Mostrar em" className="inline-flex rounded-full bg-muted p-1">
          {([["pct", "Participação"], ["brl", "Valores"]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}
              className={`min-h-9 rounded-full px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${mode === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Alimentação paga com Ticket no ciclo de {range(d, today)}{d.partial ? " (em andamento)" : ""}</div>
        {d.incomplete && d.data_from && <div data-testid="ticket-vs-own-incomplete" className="mt-1 rounded-lg bg-warning/20 px-2.5 py-1.5 text-xs text-foreground">Ciclo incompleto: o Nino só tem lançamentos do Ticket a partir de {dm(d.data_from)} e não tem a recarga deste ciclo. Fica fora das comparações.</div>}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[28px] font-bold tabular-nums">{d.total > 0 ? `${d.ticket_pct}%` : "—"}</span>
          {pp !== null && <span className="text-xs font-semibold tabular-nums text-muted-foreground">{pp === 0 ? "igual ao ciclo anterior" : `${pp > 0 ? "+" : "−"}${Math.abs(pp)} p.p. vs ciclo anterior`}</span>}
        </div>
      </div>
      <div role="group" aria-label="Alimentação por ciclo do Ticket, Ticket e dinheiro próprio. Toque num ciclo para ver os valores." className="flex h-56 gap-2.5">
        {months.map((m, i) => {
          const on = i === sel;
          const h = mode === "pct" ? 100 : (m.total / max) * 100;
          return (
            <button key={m.start} type="button" aria-pressed={on} onClick={() => choose(i)}
              aria-label={`Ciclo de ${range(m, today)}: Ticket ${m.ticket_pct}% (${formatBRL(m.ticket)}), dinheiro próprio ${m.own_pct}% (${formatBRL(m.own)})${m.incomplete ? ", ciclo incompleto" : ""}`}
              className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
              <span className="flex w-full flex-1 flex-col justify-end">
                {mode === "brl" && <span className="mb-1 text-center text-[11px] font-bold tabular-nums text-muted-foreground">{m.total > 0 ? brl0(m.total) : ""}</span>}
                <span className={`flex w-full flex-col overflow-hidden rounded-xl transition-opacity ${on ? "opacity-100" : "opacity-55"}`} style={{ height: `${m.total === 0 ? 100 : Math.max(8, h)}%` }}>
                  {m.total === 0 ? (
                    <span className="flex flex-1 items-center justify-center bg-muted text-xs text-muted-foreground">sem consumo</span>
                  ) : (
                    <>
                      {m.own > 0 && (
                        <span className={`flex min-h-0 flex-col items-center justify-center ${OWN_FILL} ${OWN_TEXT}`} style={{ flexGrow: m.own_pct }}>
                          <span className="text-[13px] font-bold tabular-nums">{mode === "pct" ? `${m.own_pct}%` : m.own_pct >= 18 ? brl0(m.own) : ""}</span>
                          {mode === "pct" && m.own_pct >= 22 && <span className="text-[10px] tabular-nums opacity-85">{brl0(m.own)}</span>}
                        </span>
                      )}
                      {m.ticket > 0 && (
                        <span className={`flex min-h-0 flex-col items-center justify-center text-white ${TICKET_FILL}`} style={{ flexGrow: m.ticket_pct }}>
                          <span className="text-[13px] font-bold tabular-nums">{mode === "pct" ? `${m.ticket_pct}%` : m.ticket_pct >= 18 ? brl0(m.ticket) : ""}</span>
                          {mode === "pct" && m.ticket_pct >= 22 && <span className="text-[10px] tabular-nums opacity-85">{brl0(m.ticket)}</span>}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </span>
              <span className={`text-center text-xs ${on ? "font-bold text-primary" : "text-muted-foreground"}`}>{monthName(m.label_month).slice(0, 3)}{m.partial ? "*" : ""}{m.incomplete ? "†" : ""}</span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className={`h-3 w-3 rounded ${TICKET_FILL}`} />Ticket</span>
        <span className="flex items-center gap-1.5"><i className={`h-3 w-3 rounded border border-border ${OWN_FILL}`} />Dinheiro próprio</span>
      </div>
      <div data-testid="ticket-vs-own-detail" className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3 text-[13px] tabular-nums">
        <div className="flex justify-between"><span>Ticket</span><span><strong className="font-semibold">{formatBRL(d.ticket)}</strong> · {d.ticket_pct}%</span></div>
        <div className="flex justify-between"><span>Dinheiro próprio</span><span><strong className="font-semibold">{formatBRL(d.own)}</strong> · {d.own_pct}%</span></div>
        <div className="flex justify-between"><span>Total em alimentação</span><strong className="font-semibold">{formatBRL(d.total)}</strong></div>
        {comparable && <div className="flex justify-between text-muted-foreground"><span>Ciclo anterior</span><span>{formatBRL(prev!.ticket)} Ticket · {formatBRL(prev!.own)} bolso</span></div>}
      </div>
      {comparable && (
        <p className="text-[13px] leading-relaxed">
          {d.ticket_pct >= prev!.ticket_pct
            ? <><strong className="font-semibold">Mais comida no Ticket.</strong> Do seu bolso saíram {formatBRL(d.own)}{d.partial ? " até agora" : ""}{diff < 0 ? `, ${formatBRL(-diff)} a menos que no ciclo anterior` : diff > 0 ? `, ${formatBRL(diff)} a mais que no ciclo anterior` : ""}.</>
            : <><strong className="font-semibold">Mais comida no bolso.</strong> O Ticket cobriu {d.ticket_pct}%, contra {prev!.ticket_pct}% no ciclo anterior. Do seu bolso saíram {formatBRL(d.own)}.</>}
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">Cada barra é um ciclo do Ticket, da recarga até a véspera da próxima, com o nome do mês em que termina. Dinheiro próprio: contas e cartões nas categorias de alimentação e mercado, pela data da compra. A participação pode subir mesmo quando o bolso gasta mais; por isso os valores aparecem junto.{months.some((m) => m.partial) ? " * ciclo em andamento." : ""}{months.some((m) => m.incomplete) ? " † ciclo com dados incompletos." : ""}</p>
    </section>
  );
}
