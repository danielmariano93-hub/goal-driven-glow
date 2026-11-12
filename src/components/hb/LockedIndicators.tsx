import { cn } from "@/lib/utils";

export interface IndicatorProgress {
  key: string;
  title: string;
  /** O que ele mostra, em uma frase. */
  what: string;
  /** Quanto já tem e quanto precisa (na unidade `unit`). Sem `need`, aparece só a condição em texto. */
  have?: number;
  need?: number;
  unit?: string;
  /** Condição em texto, para os que dependem de haver algo para analisar (ex.: dias não feitos). */
  condition?: string;
}

/**
 * Indicadores que ainda não aparecem porque faltam dados: diz o que são e o quanto falta.
 * Esconder sem explicar parece que não existem; um número pequeno de dias dá uma conclusão enganosa (por isso o mínimo).
 */
export function LockedIndicators({ items }: { items: IndicatorProgress[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Indicadores que ainda estão juntando dados">
      <h2 className="text-[12px] font-medium text-muted-foreground">Aparecem quando houver dados</h2>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Com poucos dias, qualquer número engana. Estes indicadores já estão ligados e entram sozinhos.</p>
      <ul className="mt-2 divide-y divide-border/60">
        {items.map((i) => {
          const frac = i.need ? Math.min(1, (i.have ?? 0) / i.need) : 0;
          return (
            <li key={i.key} className="py-2.5 first:pt-1.5 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] font-semibold">{i.title}</p>
                {i.need ? <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{Math.min(i.have ?? 0, i.need)} de {i.need} {i.unit}</p> : null}
              </div>
              <p className="text-[12px] leading-[17px] text-muted-foreground">{i.what}</p>
              {i.need ? <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><i className={cn("block h-full rounded-full bg-primary/70")} style={{ width: `${Math.round(frac * 100)}%` }} /></div> : null}
              {i.condition ? <p className="mt-1 text-[11px] text-muted-foreground">{i.condition}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
