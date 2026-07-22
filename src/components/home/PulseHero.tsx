import { Sparkles, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { usePulse } from "@/lib/pulse/usePulse";

export function PulseHero() {
  const { data, isLoading, isError, refetch, isFetching } = usePulse();
  const [open, setOpen] = useState(false);

  if (isLoading || isError || !data) {
    return (
      <section
        className="rounded-[18px] bg-[color:var(--home-surface)] p-4"
        style={{ border: "1px solid var(--home-hairline)" }}
      >
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
          <Sparkles size={12} /> Evolução financeira
        </div>
        <div className="mt-2 flex items-center gap-3">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : isError ? <RefreshCw className="h-4 w-4 text-destructive" /> : null}
          <p className="text-[12px]" style={{ color: "var(--home-text-2)" }}>
            {isLoading ? "Calibrando…" : isError ? "Não consegui atualizar agora." : "Anote alguns lançamentos para calibrar."}
          </p>
          {isError ? (
            <button type="button" disabled={isFetching} onClick={() => void refetch()} className="ml-auto text-[12px] font-bold" style={{ color: "var(--home-brand-violet)" }}>
              Tentar de novo
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const delta = data.week_delta ?? 0;
  const deltaLabel = delta === 0 ? "Estável" : delta > 0 ? `+${delta} pontos` : `${delta} pontos`;
  const topFactor = [...data.factors]
    .filter((f) => !f.missing)
    .sort((a, b) => b.weight * (1 - b.value) - a.weight * (1 - a.value))[0];

  const stateLabel = data.band ?? "Organizando";
  const insufficient = data.state === "insufficient_data";
  const hint = insufficient
    ? "Anote alguns lançamentos por 3 dias para ficar preciso."
    : topFactor
      ? `${topFactor.label} é o principal ponto de melhoria.`
      : data.next_action?.label ?? "";

  return (
    <section
      className="rounded-[18px] bg-[color:var(--home-surface)] p-4"
      style={{ border: "1px solid var(--home-hairline)" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full font-display font-extrabold tabular-nums"
          style={{
            background: "var(--home-surface-soft)",
            color: "var(--home-brand-ink)",
            fontSize: 24,
            letterSpacing: "-0.03em",
          }}
          aria-label={`Pontuação ${data.score}`}
        >
          {data.score}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
            Evolução financeira
          </p>
          <p className="mt-0.5 truncate text-[14px] font-bold" style={{ color: "var(--home-text-1)" }}>
            {stateLabel}
            <span className="ml-2 text-[11px] font-semibold" style={{ color: delta > 0 ? "var(--home-pos)" : delta < 0 ? "var(--home-neg)" : "var(--home-text-2)" }}>
              {deltaLabel}
            </span>
          </p>
          <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--home-text-2)" }}>
            {hint}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-[color:var(--home-surface-soft)]"
          aria-expanded={open}
          aria-label="Ver detalhes da evolução"
        >
          <ChevronRight size={16} className={`transition-transform ${open ? "rotate-90" : ""}`} style={{ color: "var(--home-text-2)" }} />
        </button>
      </div>
      {open && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--home-hairline)" }}>
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--home-surface-neutral)" }}>
            <div className="h-full rounded-full" style={{ width: `${data.score}%`, background: "var(--home-brand-violet)" }} />
          </div>
          {data.factors.filter((f) => !f.missing).slice(0, 3).map((f) => (
            <div key={f.key} className="mt-2 flex items-center justify-between gap-2 text-[11px]" style={{ color: "var(--home-text-2)" }}>
              <span className="truncate">{f.label}</span>
              <div className="h-1 w-24 shrink-0 overflow-hidden rounded-full" style={{ background: "var(--home-surface-neutral)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(f.value * 100)}%`, background: "var(--home-brand-violet)" }} />
              </div>
            </div>
          ))}
          <Link to="/app/relatorios" className="mt-3 inline-block text-[12px] font-bold hover:underline" style={{ color: "var(--home-brand-violet)" }}>
            Ver evolução →
          </Link>
        </div>
      )}
    </section>
  );
}
