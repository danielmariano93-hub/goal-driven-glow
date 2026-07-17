import { Sparkles, TrendingUp, TrendingDown, Minus, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { usePulse } from "@/lib/pulse/usePulse";

export function PulseHero() {
  const { data, isLoading } = usePulse();
  const [open, setOpen] = useState(false);

  if (isLoading || !data) {
    return (
      <section className="rounded-3xl bg-gradient-to-br from-[#21164F] via-[#6D3BFF] to-[#8B5CF6] p-6 text-white shadow-brand">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider opacity-90">
          <Sparkles size={12} /> Pulso Financeiro
        </div>
        <div className="mt-3 flex items-center gap-3">
          {isLoading ? <Loader2 className="h-6 w-6 animate-spin opacity-90" /> : <div className="h-10 w-16 animate-pulse rounded bg-white/20" />}
          <p className="text-sm opacity-90">
            {isLoading ? "Calibrando seu Pulso…" : "Vamos entender seus hábitos primeiro. Anote alguns lançamentos e o Pulso começa a se calibrar."}
          </p>
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
    <section className="rounded-3xl bg-gradient-to-br from-[#21164F] via-[#6D3BFF] to-[#8B5CF6] p-6 text-white shadow-brand">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider opacity-90">
          <Sparkles size={12} /> Pulso Financeiro
        </div>
        <div className="flex items-center gap-1 text-[11px] opacity-90">
          <DeltaIcon size={12} />
          {delta === 0 ? "estável" : delta > 0 ? `+${delta}` : `${delta}`} na semana
        </div>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <p className="font-display text-5xl font-bold tabular-nums leading-none">{data.score}</p>
        <div className="pb-1 min-w-0">
          <p className="text-xs opacity-80">de 100</p>
          <p className="text-sm font-semibold truncate">{data.band}</p>
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
        <div className="h-full rounded-full bg-white transition-all" style={{ width: `${data.score}%` }} />
      </div>
      {data.state === "insufficient_data" ? (
        <p className="mt-3 text-xs opacity-90">
          Anote alguns lançamentos para o Pulso ficar mais preciso.
        </p>
      ) : (
        <>
          <p className="mt-3 text-xs opacity-90">
            <span className="font-semibold">Próxima ação:</span> {data.next_action.label}. <span className="opacity-80">{data.next_action.hint}</span>
          </p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] opacity-90 underline-offset-2 hover:underline"
            aria-expanded={open}
          >
            {open ? "Ocultar fatores" : "Ver o que mais pesa"} <ChevronRight size={11} className={open ? "rotate-90" : ""} />
          </button>
          {open && topFactors.length > 0 && (
            <div className="mt-2 space-y-1.5 rounded-2xl bg-white/10 p-3 text-[11px]">
              {topFactors.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-2">
                  <span className="truncate">{f.label}</span>
                  <div className="h-1 w-24 flex-shrink-0 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-white" style={{ width: `${Math.round(f.value * 100)}%` }} />
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
