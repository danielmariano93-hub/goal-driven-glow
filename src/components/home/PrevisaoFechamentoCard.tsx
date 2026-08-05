import { ArrowRight, CalendarBlank, TrendDown, TrendUp } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useAssessor } from "@/context/AssessorContext";
import { formatBRL } from "@/lib/engine/facts";
import type { SpendingProjection } from "@/lib/engine/metrics";

type Props = {
  projection: SpendingProjection | null;
  availability: "available" | "partial" | "unavailable";
  loading?: boolean;
};

const confidenceLabel = { insufficient: "Base inicial", low: "Confiança baixa", medium: "Confiança média", high: "Confiança alta" } as const;

export function PrevisaoFechamentoCard({ projection, availability, loading }: Props) {
  const { openAssessor } = useAssessor();
  const positive = (projection?.projectedEndBalance ?? 0) >= 0;

  return (
    <section aria-labelledby="projection-title" className="overflow-hidden rounded-[24px] border border-border bg-card shadow-hero">
      <div className="flex items-start justify-between gap-4 p-5 pb-4">
        <div>
          <p className="text-xs font-bold text-primary">O que vem pela frente</p>
          <h2 id="projection-title" className="mt-1 text-lg font-bold text-foreground">Previsão de fechamento</h2>
        </div>
        <CalendarBlank className="h-5 w-5 shrink-0 text-muted-foreground" weight="duotone" />
      </div>

      {loading ? <div className="mx-5 mb-5 h-28 animate-pulse rounded-2xl bg-muted" /> : availability === "unavailable" || !projection ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">A previsão aparece quando houver dados suficientes do mês.</p>
      ) : projection.confidence === "insufficient" ? (
        <div className="px-5 pb-5"><p className="font-display text-lg font-bold text-foreground">Ainda é cedo para projetar este mês</p><p className="mt-1 text-sm leading-[21px] text-muted-foreground">Precisamos observar pelo menos três dias antes de mostrar uma estimativa.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 border-y border-border">
            <div className="p-4">
               <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">{positive ? <TrendUp /> : <TrendDown />} Dinheiro livre</span>
               <p className={`mt-2 font-display text-[28px] font-bold leading-[34px] tabular-nums ${positive ? "text-foreground" : "text-destructive"}`}>cerca de {formatBRL(Math.round(projection.projectedEndBalance))}</p>
               <p className="mt-1 text-xs text-muted-foreground">estimado no fim do mês</p>
            </div>
            <div className="border-l border-border p-4">
               <span className="text-xs font-semibold text-muted-foreground">Consumo estimado</span>
               <p className="mt-2 font-display text-xl font-bold tabular-nums text-foreground">{formatBRL(Math.round(projection.projectedTotalSpending))}</p>
               <p className="mt-1 text-xs text-muted-foreground">realizado + previsto</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 p-4">
             <p className="text-xs text-muted-foreground">{availability === "partial" ? "Dados incompletos" : confidenceLabel[projection.confidence]} · {projection.daysRemaining} dias restantes</p>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0 px-2 text-primary" onClick={() => openAssessor("fab")}>Planejar com o Nino <ArrowRight /></Button>
          </div>
        </>
      )}
    </section>
  );
}