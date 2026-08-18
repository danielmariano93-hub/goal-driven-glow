import { useState } from "react";
import { Compass, ChevronDown } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { CategoryGoalStrategy } from "@/lib/engine/categoryGoalStrategy";

const OUTLOOK_TONE: Record<CategoryGoalStrategy["outlook"], string> = {
  under_control: "bg-success/10 text-success",
  tight: "bg-warning/10 text-warning",
  projected_over: "bg-warning/10 text-warning",
  exceeded: "bg-destructive/10 text-destructive",
  scheduled: "bg-secondary text-muted-foreground",
  closed_ok: "bg-success/10 text-success",
  closed_over: "bg-destructive/10 text-destructive",
  paused: "bg-secondary text-muted-foreground",
};

const OUTLOOK_LABEL: Record<CategoryGoalStrategy["outlook"], string> = {
  under_control: "Dentro do teto",
  tight: "Aperta, mas cabe",
  projected_over: "Vai furar no ritmo atual",
  exceeded: "Teto ultrapassado",
  scheduled: "Ainda não começou",
  closed_ok: "Fechou dentro",
  closed_over: "Fechou acima",
  paused: "Pausada",
};

const METHOD_LABEL: Record<string, string> = {
  flow: "Projetado pelo ritmo de gasto",
  commitment: "Projetado pelas cobranças conhecidas",
  hybrid: "Cobranças conhecidas + parcela variável",
  insufficient_data: "Sem dados suficientes para projetar",
  linear: "Projetado pelo ritmo de gasto",
  weekday_weighted: "Projetado pelo ritmo de gasto",
};


type Props = {
  strategy: CategoryGoalStrategy;
  /** Aberto por padrão na tela de detalhe. */
  defaultOpen?: boolean;
};

/** Plano do Nino para um teto de categoria: quanto cabe, onde cortar e o próximo passo. */
export function CategoryGoalStrategyCard({ strategy, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mt-3 rounded-2xl border border-border bg-background p-3">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((value) => !value); }}
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
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${OUTLOOK_TONE[strategy.outlook]}`}>
          {OUTLOOK_LABEL[strategy.outlook]}
        </span>
        {strategy.dailyAllowance > 0 ? (
          <span className="text-[10px] text-muted-foreground">{formatBRL(strategy.dailyAllowance)}/dia disponíveis</span>
        ) : null}
        {strategy.requiredDailyCut > 0 ? (
          <span className="text-[10px] text-muted-foreground">Corte de {formatBRL(strategy.requiredDailyCut)}/dia</span>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <p className="text-muted-foreground">
                Projeção do período{strategy.projectionConfidence === "low" ? " (estimativa)" : ""}
              </p>
              <p className="font-semibold tabular-nums">{formatBRL(strategy.projectedFinalSpend)}</p>
              <p className="text-[10px] text-muted-foreground">{METHOD_LABEL[strategy.projectionMethod] ?? "Ritmo observado"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Margem atual</p>
              <p className={`font-semibold tabular-nums ${strategy.currentOverage > 0 ? "text-destructive" : ""}`}>
                {strategy.currentOverage > 0
                  ? `-${formatBRL(strategy.currentOverage)}`
                  : formatBRL(strategy.remainingAmount)}
              </p>
              {strategy.projectedOverage > 0 ? (
                <p className="text-[10px] text-warning">
                  Excesso projetado: {formatBRL(strategy.projectedOverage)}
                </p>
              ) : null}
            </div>
          </div>

          {strategy.expectedCommitments.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Cobranças ainda previstas</p>
              <ul className="mt-1 space-y-1">
                {strategy.expectedCommitments.map((item) => (
                  <li key={`${item.label}-${item.expectedAt}`} className="flex items-start justify-between gap-2 text-[11px] leading-4">
                    <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatBRL(item.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {strategy.hotspots.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Onde o dinheiro está indo</p>
              <ul className="mt-1 space-y-1">
                {strategy.hotspots.map((hotspot) => (
                  <li key={hotspot.label} className="flex items-start justify-between gap-2 text-[11px] leading-4">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {hotspot.label} · {Math.round(hotspot.sharePct)}%
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatBRL(hotspot.amount)}</span>
                  </li>
                ))}
                {strategy.others.amount > 0 ? (
                  <li className="flex items-start justify-between gap-2 text-[11px] leading-4">
                    <span className="min-w-0 truncate text-muted-foreground">
                      Outros · {Math.round(strategy.others.sharePct)}%
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatBRL(strategy.others.amount)}</span>
                  </li>
                ) : null}
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
