import { ArrowDownRight, ArrowUpRight, Scales } from "@phosphor-icons/react";
import { formatBRL } from "@/lib/engine/facts";
import { formatPeriodLabel } from "@/lib/ui/periodStore";
import type { PeriodPerformance } from "@/lib/engine/bridges";
import { cn } from "@/lib/utils";

type Props = {
  performance: PeriodPerformance | null;
  periodStart: string;
  periodEnd: string;
  loading?: boolean;
};

/**
 * Resumo do PERÍODO SELECIONADO (entradas, saídas e resultado). É o bloco que
 * responde ao filtro de período — os cartões de posição de hoje não respondem
 * por definição. Números vindos de `periodPerformance` do motor único.
 */
export function ResumoPeriodoCard({ performance, periodStart, periodEnd, loading }: Props) {
  const label = formatPeriodLabel(periodStart, periodEnd);
  const income = performance?.operationalIncome ?? 0;
  const expense = performance?.operationalExpense ?? 0;
  const result = performance?.operationalResult ?? 0;
  const empty = !loading && performance != null && income === 0 && expense === 0;

  return (
    <section aria-label="Resumo do período" className="rounded-[18px] border border-border bg-card p-3.5 shadow-sm animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-primary">Período selecionado</p>
          <h2 className="mt-0.5 font-display text-[15px] font-bold leading-5 text-foreground">Resumo do período</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
        </div>
        <Scales size={18} className="shrink-0 text-muted-foreground" />
      </div>

      {loading ? (
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-secondary" aria-hidden />
      ) : empty ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Não encontrei lançamentos nesse intervalo. Escolha outro período ou registre o que aconteceu ali.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div>
              <p className="text-[10px] font-medium text-muted-foreground">Entrou</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-bold tabular-nums text-success">
                <ArrowUpRight weight="bold" size={13} />{formatBRL(income)}
              </p>
            </div>
            <div className="border-l border-border pl-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">Saiu</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-bold tabular-nums text-destructive">
                <ArrowDownRight weight="bold" size={13} />{formatBRL(expense)}
              </p>
            </div>
            <div className="border-l border-border pl-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">Resultado</p>
              <p className={cn("mt-0.5 text-[13px] font-bold tabular-nums", result < 0 ? "text-destructive" : "text-success")}>
                {formatBRL(result)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {result < 0
              ? `Nesse período você gastou ${formatBRL(Math.abs(result))} além do que entrou.`
              : `Nesse período sobraram ${formatBRL(result)} depois dos gastos da rotina.`}
          </p>
        </>
      )}
    </section>
  );
}
