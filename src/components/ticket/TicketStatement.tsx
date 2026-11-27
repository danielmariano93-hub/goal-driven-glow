import { useMemo, useState } from "react";
import { Pencil, Search, Trash2, X } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import { filterStatement, statementTotals, WEEKDAY_FULL, type SourceFilter, type StatementKind, type StatementRow } from "@/lib/engine/ticketAnalytics";
import { dm } from "./sourceStyle";
import { SourceFilterChips } from "./SourceFilterChips";

export interface StatementFilterState {
  cycleOnly: boolean;
  source: SourceFilter;
  kinds: StatementKind[];
  merchantKey: string | null;
  merchantLabel: string | null;
  weekday: number | null;
  search: string;
}
export const EMPTY_STATEMENT_FILTERS: StatementFilterState = { cycleOnly: true, source: "total", kinds: [], merchantKey: null, merchantLabel: null, weekday: null, search: "" };

const KIND_LABEL: Record<StatementKind, string> = { purchase: "Compra", credit: "Recarga", reading: "Saldo informado", adjustment: "Ajuste" };
const KIND_FILTERS: Array<[StatementKind, string]> = [["purchase", "Compras"], ["credit", "Recargas"], ["reading", "Saldo informado"]];
const PAGE = 30;
const WD = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const weekdayLabel = (iso: string) => WD[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7];

/** Extrato único: lançamentos do Ticket e gastos de comida pagos do bolso, com busca, filtros e totais.
 *  Editar e excluir usam os fluxos que já existiam (só para lançamentos do Ticket). */
export function TicketStatement({ rows, filters, onChange, cycleRange, onEdit, onRemove, removing }: {
  rows: StatementRow[];
  filters: StatementFilterState;
  onChange: (f: StatementFilterState) => void;
  cycleRange: { from: string; to: string; label: string } | null;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  const [shown, setShown] = useState(PAGE);
  const [confirming, setConfirming] = useState<string | null>(null);
  const set = (patch: Partial<StatementFilterState>) => { setShown(PAGE); onChange({ ...filters, ...patch }); };
  const filtered = useMemo(() => filterStatement(rows, {
    from: filters.cycleOnly ? cycleRange?.from : null, to: filters.cycleOnly ? cycleRange?.to : null,
    source: filters.source, kinds: filters.kinds, merchantKey: filters.merchantKey, weekday: filters.weekday, search: filters.search,
  }), [rows, filters, cycleRange]);
  const totals = statementTotals(filtered);
  const visible = filtered.slice(0, shown);
  const groups: Array<[string, StatementRow[]]> = [];
  for (const r of visible) {
    const last = groups[groups.length - 1];
    if (last && last[0] === r.date) last[1].push(r); else groups.push([r.date, [r]]);
  }
  const active = filters.source !== "total" || filters.kinds.length > 0 || !!filters.merchantKey || filters.weekday !== null || !!filters.search || !filters.cycleOnly;
  return (
    <div className="flex flex-col gap-3" data-testid="ticket-statement">
      <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-border bg-card px-3">
        <Search size={18} className="text-muted-foreground" aria-hidden />
        <input id="ticket-statement-search" value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Buscar estabelecimento"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Buscar estabelecimento" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={filters.cycleOnly} onClick={() => set({ cycleOnly: !filters.cycleOnly })}
          className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${filters.cycleOnly ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}>
          {filters.cycleOnly && cycleRange ? cycleRange.label : "Todos os ciclos"}
        </button>
        <SourceFilterChips value={filters.source} onChange={(s) => set({ source: s })} label="Fonte" options={["total", "ticket", "own"]} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {KIND_FILTERS.map(([k, l]) => {
          const on = filters.kinds.includes(k);
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => set({ kinds: on ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k] })}
              className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${on ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}>{l}</button>
          );
        })}
        {filters.merchantKey && (
          <button type="button" onClick={() => set({ merchantKey: null, merchantLabel: null })} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">
            {filters.merchantLabel} <X size={14} aria-label="remover filtro de estabelecimento" />
          </button>
        )}
        {filters.weekday !== null && (
          <button type="button" onClick={() => set({ weekday: null })} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">
            {WEEKDAY_FULL[filters.weekday]} <X size={14} aria-label="remover filtro de dia da semana" />
          </button>
        )}
        {active && <button type="button" onClick={() => set(EMPTY_STATEMENT_FILTERS)} className="min-h-9 px-2 text-xs font-semibold text-primary">Limpar filtros</button>}
      </div>

      <section className="surface-card grid grid-cols-3 gap-2 p-4 text-center" data-testid="ticket-statement-totals">
        <div><div className="text-[11px] text-muted-foreground">Consumo</div><div className="text-base font-bold tabular-nums">{formatBRL(totals.consumption)}</div></div>
        <div><div className="text-[11px] text-muted-foreground">Compras</div><div className="text-base font-bold tabular-nums">{totals.purchases}</div></div>
        <div><div className="text-[11px] text-muted-foreground">Recargas</div><div className="text-base font-bold tabular-nums">{totals.credits ? formatBRL(totals.credits_total) : "—"}</div></div>
      </section>

      {filtered.length === 0 ? (
        <div className="surface-card flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
          Nenhum lançamento com esses filtros.
          {active && <button type="button" onClick={() => set(EMPTY_STATEMENT_FILTERS)} className="min-h-11 rounded-xl border border-border px-4 font-semibold text-foreground">Limpar filtros</button>}
        </div>
      ) : (
        <section className="surface-card flex flex-col p-4" data-testid="ticket-statement-list">
          {groups.map(([date, items]) => (
            <div key={date} className="flex flex-col">
              <div className="pb-1 pt-2 text-xs font-semibold text-muted-foreground">{weekdayLabel(date)}, {dm(date)}</div>
              {items.map((r) => (
                <div key={`${r.source}-${r.id}`} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.merchant || KIND_LABEL[r.kind]}</div>
                    <div className="text-xs text-muted-foreground">{KIND_LABEL[r.kind]} · {r.source === "ticket" ? "Ticket" : "Conta ou cartão"}{r.note && /^\d{2}:\d{2}$/.test(r.note) ? ` · ${r.note}` : ""}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <strong className={`font-semibold tabular-nums ${r.kind === "credit" ? "text-success" : ""}`}>
                      {r.kind === "purchase" ? "− " : r.kind === "credit" ? "+ " : ""}{formatBRL(Math.abs(r.amount))}
                    </strong>
                    {r.source === "ticket" && r.editable && (
                      <button aria-label="Editar lançamento" onClick={() => onEdit(r.id)} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><Pencil size={16} /></button>
                    )}
                    {r.source === "ticket" && (confirming === r.id ? (
                      <span className="flex items-center gap-1">
                        <button type="button" disabled={removing} onClick={() => { onRemove(r.id); setConfirming(null); }} className="min-h-10 rounded-full bg-destructive px-3 text-xs font-semibold text-destructive-foreground">Excluir</button>
                        <button type="button" onClick={() => setConfirming(null)} className="min-h-10 rounded-full px-2 text-xs font-semibold text-muted-foreground">Cancelar</button>
                      </span>
                    ) : (
                      <button aria-label="Excluir lançamento" disabled={removing} onClick={() => setConfirming(r.id)} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><Trash2 size={16} /></button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {filtered.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-3 min-h-11 rounded-xl border border-border text-sm font-semibold">
              Carregar mais ({filtered.length - shown} restantes)
            </button>
          )}
        </section>
      )}
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">Gastos de conta ou cartão aparecem aqui só para consulta; para corrigi-los, use Movimentos.</p>
    </div>
  );
}
