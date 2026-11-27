import { formatBRL } from "@/lib/engine/facts";
import { WEEKDAY_FULL, WEEKDAY_PLURAL, type WeekdayAverages } from "@/lib/engine/ticketAnalytics";

/** Média por dia da semana (dias sem compra contam como zero), no desenho arredondado do "Quando eu gasto".
 *  Traço cinza = média do ciclo anterior. A seleção atualiza o detalhe; o insight geral fica fora, em "No período". */
export function WeekdayAvgChart({ data, previous, selected, onSelect }: { data: WeekdayAverages; previous: WeekdayAverages | null; selected: number | null; onSelect: (wd: number | null) => void }) {
  const vals = data.by_weekday.map((d) => d.avg ?? 0);
  const prevVals = previous ? previous.by_weekday.map((d) => d.avg ?? 0) : [];
  const max = Math.max(1, ...vals, ...prevVals);
  const sel = selected !== null ? data.by_weekday[selected] : null;
  const prevSel = selected !== null && previous ? previous.by_weekday[selected] : null;
  return (
    <div>
      <div role="group" aria-label="Média de gasto por dia da semana. Toque numa barra para ver o detalhe." className="flex items-end justify-between gap-1 px-1">
        {data.by_weekday.map((d) => {
          const on = d.weekday === selected;
          const prev = previous?.by_weekday[d.weekday]?.avg ?? null;
          return (
            <button key={d.weekday} type="button" aria-pressed={on}
              aria-label={`${WEEKDAY_FULL[d.weekday]}: média de ${formatBRL(d.avg ?? 0)} por dia em ${d.occurrences} ${WEEKDAY_PLURAL[d.weekday]}${prev !== null ? `; ciclo anterior ${formatBRL(prev)}` : ""}`}
              onClick={() => onSelect(on ? null : d.weekday)}
              className="flex min-h-11 flex-1 flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span className={`text-[11px] font-bold tabular-nums ${on ? "text-primary" : "text-muted-foreground"}`}>{d.avg !== null ? Math.round(d.avg) : "—"}</span>
              <div className="relative flex h-24 w-full items-end justify-center">
                <div className={`w-7 rounded-md transition-colors ${on ? "bg-primary" : "bg-primary/30"}`} style={{ height: `${Math.max(4, ((d.avg ?? 0) / max) * 100)}%` }} />
                {prev !== null && <div aria-hidden className="absolute left-1/2 h-0.5 w-9 -translate-x-1/2 rounded bg-muted-foreground/70" style={{ bottom: `calc(${(prev / max) * 100}% - 1px)` }} />}
              </div>
              <span className={`text-xs ${on ? "font-bold text-primary" : "text-muted-foreground"}`}>{d.label}</span>
            </button>
          );
        })}
      </div>
      <p data-testid="weekday-avg-detail" className="mt-3 min-h-[2.5rem] text-center text-xs leading-relaxed tabular-nums text-muted-foreground">
        {sel ? (
          <>
            <strong className="font-semibold text-foreground">{WEEKDAY_FULL[sel.weekday]}</strong>: média de {formatBRL(sel.avg ?? 0)} por dia · total {formatBRL(sel.total)} em {sel.occurrences} {WEEKDAY_PLURAL[sel.weekday]}
            {prevSel && prevSel.avg !== null ? <> · ciclo anterior {formatBRL(prevSel.avg)} ({(sel.avg ?? 0) - prevSel.avg >= 0 ? "+" : "−"}{formatBRL(Math.abs((sel.avg ?? 0) - prevSel.avg))})</> : null}
          </>
        ) : "Toque num dia para ver média, total e comparação."}
      </p>
    </div>
  );
}
