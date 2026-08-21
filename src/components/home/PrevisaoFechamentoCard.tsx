import { ArrowRight, CalendarBlank, Info, TrendDown, TrendUp } from "@phosphor-icons/react";
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
    <section aria-labelledby="projection-title" className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-4 px-3.5 pb-2.5 pt-3.5">
        <div>
          <p className="text-[11px] font-bold text-primary">O que vem pela frente</p>
          <h2 id="projection-title" className="mt-0.5 text-base font-bold text-foreground">Previsão de fechamento</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Do mês corrente · não muda com o período escolhido</p>
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
            <div className="p-3.5">
               <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">{positive ? <TrendUp /> : <TrendDown />} Dinheiro livre</span>
               <p className={`mt-1.5 font-display text-xl font-bold leading-6 tabular-nums ${positive ? "text-foreground" : "text-destructive"}`}>{formatBRL(Math.round(projection.projectedEndBalance))}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">estimado no fim do mês{projection.estimatedFixedInflows > 0 ? " · inclui renda esperada" : ""}</p>
            </div>
            <div className="border-l border-border p-3.5">
               <span className="text-[11px] font-semibold text-muted-foreground">Consumo estimado</span>
               <p className="mt-1.5 font-display text-lg font-bold tabular-nums text-foreground">{formatBRL(Math.round(projection.projectedTotalSpending))}</p>
               <p className="mt-0.5 text-[11px] text-muted-foreground">realizado + previsto</p>
            </div>
          </div>
          <details className="border-t border-border px-3.5 py-2">
            <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-1.5 text-[11px] font-semibold text-primary"><span className="inline-flex items-center gap-1.5"><Info size={14} /> Ver cálculo e premissas</span><span className="text-[10px] font-medium text-muted-foreground">abrir</span></summary>
            <p className="mt-1 text-[11px] leading-[17px] text-muted-foreground">
              Saldo disponível + entradas confirmadas ou estimadas − contas com data − fatura do mês − ritmo variável típico até o fim do mês. Gastos atípicos não distorcem o ritmo, mas continuam no realizado.
            </p>
            <dl className="mt-2 grid gap-1 rounded-xl bg-muted/40 p-2.5 text-[11px]">
              <CompositionRow label="Disponível hoje" value={projection.composition.availableToday} />
              {projection.composition.confirmedFutureInflows > 0 ? <CompositionRow label="Entradas confirmadas" value={projection.composition.confirmedFutureInflows} /> : null}
              {projection.composition.estimatedFixedInflows > 0 ? <CompositionRow label="Renda fixa estimada" value={projection.composition.estimatedFixedInflows} /> : null}
              {projection.composition.knownCommitments > 0 ? <CompositionRow label={`Compromissos com data (${projection.composition.commitmentsCount})`} value={-projection.composition.knownCommitments} /> : null}
              {projection.composition.cardDueThisMonth > 0 ? <CompositionRow label={projection.composition.cardDueIsEstimated ? "Cartão do mês (estimado)" : "Fatura do mês (oficial)"} value={-projection.composition.cardDueThisMonth} /> : null}
              {projection.composition.projectedVariableSpending > 0 ? <CompositionRow label="Gasto variável previsto" value={-projection.composition.projectedVariableSpending} /> : null}
            </dl>
            <SourceBreakdown bySource={projection.composition.commitmentsBySource} />
          </details>
           <div className="flex items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
              <p className="text-[11px] text-muted-foreground">{availability === "partial" ? "Dados incompletos" : confidenceLabel[projection.confidence]} · {projection.daysRemaining} dias</p>
             <Button type="button" variant="ghost" size="sm" className="min-h-10 shrink-0 px-1.5 text-[12px] text-primary" onClick={() => openAssessor("fab")}>Planejar com o Nino <ArrowRight /></Button>
          </div>

        </>
      )}
    </section>
  );
}
function CompositionRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-semibold tabular-nums ${value < 0 ? "text-destructive" : "text-foreground"}`}>
        {value < 0 ? "−" : ""}{formatBRL(Math.abs(Math.round(value)))}
      </dd>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  card_statement: "Faturas de cartão",
  card_installment: "Parcelas de cartão",
  recurring: "Recorrências",
  planned: "Lançamentos planejados",
  debt_installment: "Parcelas de dívida",
  donation_goal: "Metas de doação",
};

/** Memória de cálculo dos compromissos: cada origem aparece com seu valor. */
function SourceBreakdown({ bySource }: { bySource: Record<string, number> }) {
  const rows = Object.entries(bySource).filter(([, value]) => value > 0);
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 border-t border-border pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Origem dos compromissos</p>
      <dl className="mt-1.5 grid gap-1 text-[11px]">
        {rows.map(([source, value]) => (
          <div key={source} className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{SOURCE_LABEL[source] ?? source}</dt>
            <dd className="font-semibold tabular-nums text-foreground">{formatBRL(Math.round(value))}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
