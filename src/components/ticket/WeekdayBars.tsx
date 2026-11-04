import { useState } from "react";
import { formatBRL } from "@/lib/engine/facts";
import type { WeekdayPattern } from "@/lib/engine/benefitWallet";

const FULL = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"] as const;

/** Gasto por dia da semana; o pico vem selecionado e qualquer barra pode ser tocada para ver o valor daquele dia. */
export function WeekdayBars({ pattern }: { pattern: WeekdayPattern }) {
  const max = Math.max(1, ...pattern.by_weekday.map((d) => d.total));
  const [picked, setPicked] = useState<number | null>(null);
  const active = picked ?? pattern.peak?.weekday ?? null;
  const sel = active !== null ? pattern.by_weekday[active] : null;
  return (
    <div>
      <div role="group" aria-label="Gasto no Ticket por dia da semana. Toque numa barra para ver o valor." className="flex items-end justify-between gap-1 px-1">
        {pattern.by_weekday.map((d) => {
          const on = d.weekday === active;
          return (
            <button
              key={d.weekday}
              type="button"
              aria-pressed={on}
              aria-label={`${FULL[d.weekday]}: ${d.total > 0 ? `${formatBRL(d.total)}, ${d.share_pct}% do gasto` : "sem gastos"}`}
              onClick={() => setPicked(on && picked !== null ? null : d.weekday)}
              className="flex min-h-11 flex-1 flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className={`text-[11px] font-bold tabular-nums ${on ? "text-primary" : "text-transparent"}`}>{d.total > 0 ? formatBRL(d.total) : "—"}</span>
              <div className="flex h-24 w-full items-end justify-center">
                <div className={`w-7 rounded-md transition-colors ${on ? "bg-primary" : "bg-primary/30"}`} style={{ height: `${Math.max(4, (d.total / max) * 100)}%` }} />
              </div>
              <span className={`text-xs ${on ? "font-bold text-primary" : "text-muted-foreground"}`}>{d.label}</span>
            </button>
          );
        })}
      </div>
      {sel ? (
        <p data-testid="weekday-detail" className="mt-2 text-center text-xs tabular-nums text-muted-foreground">
          {sel.total > 0
            ? <><strong className="font-semibold text-foreground">{FULL[sel.weekday][0].toUpperCase()}{FULL[sel.weekday].slice(1)}</strong>: {formatBRL(sel.total)} no total ({sel.share_pct}%) · média de {formatBRL(sel.avg_per_occurrence)} por dia</>
            : <><strong className="font-semibold text-foreground">{FULL[sel.weekday][0].toUpperCase()}{FULL[sel.weekday].slice(1)}</strong>: sem gastos no período</>}
        </p>
      ) : null}
    </div>
  );
}
