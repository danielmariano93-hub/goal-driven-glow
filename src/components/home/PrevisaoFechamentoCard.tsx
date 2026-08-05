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
    <section aria-labelledby="projection-title" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-start justify-between gap-4 p-4 pb-3">
        <div>
          <p className="text-xs font-bold text-primary">O que vem pela frente</p>
          <h2 id="projection-title" className="mt-1 text-lg font-bold text-foreground">Previsão de fechamento</h2>
        </div>
        <CalendarBlank className="h-5 w-5 shrink-0 text-muted-foreground" weight="duotone" />
      </div>

      {loading ? <div className="mx-4 mb-4 h-28 animate-pulse rounded-lg bg-muted" /> : availability === "unavailable" || !projection ? (
        <p className="px-4 pb-5 text-sm text-muted-foreground">A previsão aparece quando houver dados suficientes do mês.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 border-y border-border">
            <div className="p-4">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">{positive ? <TrendUp /> : <TrendDown />} Dinheiro livre</span>
              <p className={`mt-2 text-xl font-extrabold tabular-nums ${positive ? "text-success" : "text-destructive"}`}>{formatBRL(projection.projectedEndBalance)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">estimado no fim do mês</p>
            </div>
            <div className="border-l border-border p-4">
              <span className="text-[11px] font-semibold text-muted-foreground">Consumo estimado</span>
              <p className="mt-2 text-xl font-extrabold tabular-nums text-foreground">{formatBRL(projection.projectedTotalSpending)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">realizado + previsto</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 p-4">
            <p className="text-[11px] text-muted-foreground">{availability === "partial" ? "Estimativa parcial" : confidenceLabel[projection.confidence]} · {projection.daysRemaining} dias restantes</p>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0 px-2 text-primary" onClick={() => openAssessor("fab")}>Planejar com o Nino <ArrowRight /></Button>
          </div>
        </>
      )}
    </section>
  );
}