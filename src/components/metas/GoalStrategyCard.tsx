import { useState } from "react";
import { Compass, ChevronDown } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { GoalStrategy } from "@/lib/engine/goalStrategy";

const FEASIBILITY_TONE: Record<GoalStrategy["feasibility"], string> = {
  on_track: "bg-success/10 text-success",
  tight: "bg-warning/10 text-warning",
  unfeasible: "bg-destructive/10 text-destructive",
  no_deadline: "bg-secondary text-muted-foreground",
  completed: "bg-success/10 text-success",
};

const FEASIBILITY_LABEL: Record<GoalStrategy["feasibility"], string> = {
  on_track: "No caminho",
  tight: "Aperta, mas cabe",
  unfeasible: "Não fecha no prazo",
  no_deadline: "Sem prazo definido",
  completed: "Meta alcançada",
};

/** Plano do Nino para a meta: quanto, de onde tirar e o próximo passo. */
export function GoalStrategyCard({ strategy }: { strategy: GoalStrategy }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 rounded-2xl border border-border bg-background p-3">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Compass size={12} /> Plano do Nino
          </span>
          <span className="mt-1 block text-xs leading-5 text-foreground">{strategy.headline}</span>
        </span>
        <ChevronDown size={14} className={`mt-1 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${FEASIBILITY_TONE[strategy.feasibility]}`}>
          {FEASIBILITY_LABEL[strategy.feasibility]}
        </span>
        {strategy.requiredMonthly ? (
          <span className="text-[10px] text-muted-foreground">
            {formatBRL(strategy.requiredMonthly)}/mês
            {strategy.requiredWeekly ? ` · ${formatBRL(strategy.requiredWeekly)}/semana` : ""}
          </span>
        ) : null}
        {strategy.surplusUsePct != null ? (
          <span className="text-[10px] text-muted-foreground">Usa {Math.round(strategy.surplusUsePct)}% da sua sobra</span>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {strategy.fundingSources.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">De onde tirar</p>
              <ul className="mt-1 space-y-1">
                {strategy.fundingSources.slice(0, 4).map((source) => (
                  <li key={source.name} className="flex items-start justify-between gap-2 text-[11px] leading-4">
                    <span className="text-muted-foreground">{source.detail}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatBRL(source.monthlyAmount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {strategy.steps.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Passos</p>
              <ol className="mt-1 space-y-1.5">
                {strategy.steps.map((step) => (
                  <li key={step.id} className="text-[11px] leading-4">
                    <span className="font-semibold text-foreground">{step.title}</span>
                    <span className="block text-muted-foreground">{step.detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {strategy.alternatives.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Alternativas honestas</p>
              <ul className="mt-1 space-y-1">
                {strategy.alternatives.map((alternative) => (
                  <li key={alternative.label} className="text-[11px] leading-4">
                    <span className="font-semibold text-foreground">{alternative.label}: </span>
                    <span className="text-muted-foreground">{alternative.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="rounded-xl bg-primary/10 px-3 py-2 text-[11px] leading-4 text-primary">
            Próximo passo: {strategy.nextAction}
          </p>
        </div>
      ) : null}
    </div>
  );
}
