import { Sparkles, TrendingUp, TrendingDown, Minus, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { usePulse } from "@/lib/pulse/usePulse";

export function PulseHero() {
  const { data, isLoading, isError, refetch, isFetching } = usePulse();
  const [open, setOpen] = useState(false);

  if (isLoading || isError || !data) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles size={12} /> Pulso Financeiro
        </div>
        <div className="mt-2 flex items-center gap-3">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : isError ? <RefreshCw className="h-4 w-4 text-destructive" /> : <div className="h-4 w-10 animate-pulse rounded bg-muted" />}
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Calibrando seu Pulso…" : isError ? "Não consegui atualizar seu Pulso agora." : "Vamos entender seus hábitos primeiro. Anote alguns lançamentos e o Pulso começa a se calibrar."}
          </p>
          {isError ? <button type="button" disabled={isFetching} onClick={() => void refetch()} className="ml-auto text-xs font-semibold text-primary">Tentar de novo</button> : null}
        </div>
      </section>
    );
  }

  const delta = data.week_delta ?? 0;
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const topFactors = [...data.factors]
    .filter((f) => !f.missing)
    .sort((a, b) => b.weight * (1 - b.value) - a.weight * (1 - a.value))
    .slice(0, 3);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 font-display text-lg font-bold tabular-nums text-primary ring-1 ring-primary/15">
          {data.score}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">Pulso Financeiro · {data.band}</p>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
              <DeltaIcon size={10} /> {delta === 0 ? "estável" : delta > 0 ? `+${delta}` : `${delta}`}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-[#F06467] transition-all motion-reduce:transition-none" style={{ width: `${data.score}%` }} />
          </div>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-expanded={open} aria-label="Ver detalhes do Pulso">
          <ChevronRight size={16} className={`transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
        </button>
      </div>
      {data.state === "insufficient_data" ? (
        <p className="mt-2 pl-14 text-xs text-muted-foreground">
          Ainda estamos conhecendo seus hábitos.
        </p>
      ) : (
        <>
          <p className="mt-2 pl-14 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Próximo passo:</span> {data.next_action.label}
          </p>
          {open && topFactors.length > 0 && (
            <div className="mt-3 space-y-2 rounded-xl bg-muted/50 p-3 text-[11px] text-muted-foreground">
              {topFactors.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-2">
                  <span className="truncate">{f.label}</span>
                  <div className="h-1 w-24 flex-shrink-0 overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(f.value * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
