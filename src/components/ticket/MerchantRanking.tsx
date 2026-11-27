import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import { deltaMoney, WEEKDAY_FULL, type MerchantRow, type SourceFilter } from "@/lib/engine/ticketAnalytics";
import { OWN_FILL, TICKET_FILL } from "./sourceStyle";
import { SourceFilterChips } from "./SourceFilterChips";

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

/** Ranking horizontal por estabelecimento, escala comum (a maior linha ocupa a barra inteira). O filtro muda só a
 *  ordenação; a composição Ticket/bolso continua na barra. */
export function MerchantRanking({ rows, sortBy, onSort, hasPrevious, onOpen }: {
  rows: MerchantRow[]; sortBy: SourceFilter; onSort: (s: SourceFilter) => void; hasPrevious: boolean;
  onOpen: (merchantKey: string, label: string) => void;
}) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <section className="surface-card flex flex-col gap-3 p-5" data-testid="ticket-merchant-ranking">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Onde você mais gasta</h2>
        <SourceFilterChips value={sortBy} onChange={onSort} label="Ordenar por" options={["total", "ticket", "own"]} />
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        Ordenado por {sortBy === "total" ? "total" : sortBy === "ticket" ? "gasto no Ticket" : "gasto do bolso"}; a barra sempre mostra as duas fontes.
      </p>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Sem gastos de alimentação neste ciclo.</p>}
      <ul className="flex flex-col gap-1">
        {shown.map((r) => {
          const expanded = open === r.key;
          const d = hasPrevious ? deltaMoney(r.total, r.prev_total) : null;
          const share = r.total > 0 ? Math.round((r.ticket / r.total) * 100) : 0;
          const prevShare = r.prev_total > 0 ? Math.round((r.prev_ticket / r.prev_total) * 100) : null;
          return (
            <li key={r.key} className="border-b border-border py-2 last:border-0">
              <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.key)}
                className="flex w-full flex-col gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold">{r.label}</span>
                  <span className="shrink-0 text-sm font-bold tabular-nums">{formatBRL(r.total)}</span>
                </span>
                <span className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className={TICKET_FILL} style={{ width: `${(r.ticket / max) * 100}%` }} />
                  <span className={OWN_FILL} style={{ width: `${(r.own / max) * 100}%` }} />
                </span>
                <span className="flex w-full items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground">
                  <span>Ticket {formatBRL(r.ticket)} · Bolso {formatBRL(r.own)}</span>
                  <span className="flex items-center gap-1">
                    {r.count} {r.count === 1 ? "compra" : "compras"}
                    {d && d.kind !== "none" ? ` · ${d.kind === "new" ? "novo" : `${sign(d.abs)}${formatBRL(Math.abs(d.abs))}`}` : ""}
                    <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </span>
                </span>
              </button>
              {expanded && (
                <div className="mt-2 flex flex-col gap-1.5 rounded-xl bg-muted/50 p-3 text-xs tabular-nums" data-testid="ticket-merchant-detail">
                  <div className="flex justify-between"><span>Valor médio por compra</span><strong className="font-semibold">{formatBRL(r.avg)}</strong></div>
                  <div className="flex justify-between"><span>Parte paga com Ticket</span><strong className="font-semibold">{share}%{prevShare !== null ? ` (antes ${prevShare}%)` : ""}</strong></div>
                  {hasPrevious && (
                    r.prev_count > 0
                      ? <div className="flex justify-between"><span>Ciclo anterior</span><span>{formatBRL(r.prev_ticket)} Ticket · {formatBRL(r.prev_own)} bolso · {r.prev_count} {r.prev_count === 1 ? "compra" : "compras"}</span></div>
                      : <div className="text-muted-foreground">Sem gasto aqui no ciclo anterior.</div>
                  )}
                  {d && d.kind === "change" && <div className="flex justify-between"><span>Variação</span><span>{sign(d.abs)}{formatBRL(Math.abs(d.abs))}{d.pct !== null ? ` (${sign(d.pct)}${Math.abs(d.pct)}%)` : ""}</span></div>}
                  {!hasPrevious && <div className="text-muted-foreground">Comparação indisponível para este ciclo.</div>}
                  {r.top_weekday !== null && <div className="flex justify-between"><span>Dia mais frequente</span><span>{WEEKDAY_FULL[r.top_weekday]}</span></div>}
                  <button type="button" onClick={() => onOpen(r.key, r.label)} className="mt-1 min-h-11 rounded-xl border border-border bg-card text-sm font-semibold">Ver lançamentos</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > 5 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="min-h-11 rounded-xl border border-border text-sm font-semibold">
          {all ? "Mostrar só os 5 primeiros" : `Ver todos (${rows.length})`}
        </button>
      )}
    </section>
  );
}
